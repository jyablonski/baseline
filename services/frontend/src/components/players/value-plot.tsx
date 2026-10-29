"use client";

import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { PlayerValueScatter } from "@/components/charts/player-value-scatter";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api, queryErrorMessage } from "@/lib/api";
import {
  foldName,
  median,
  MVP_CANDIDATE_RANK,
  playerValuePoints,
  VALUE_CATEGORIES,
  type PlayerValuePoint,
  type ValueCategory,
  VALUE_GAP,
} from "@/lib/player-value";
import { formatStat } from "@/lib/format";
import { cn } from "@/lib/utils";

const GAP_POINTS = Math.round(VALUE_GAP * 100);

const CATEGORY_RULES: Record<ValueCategory, string> = {
  mvp: `Top ${MVP_CANDIDATE_RANK} in the league by MVP score, whatever they are paid.`,
  undervalued: `MVP score ranks at least ${GAP_POINTS} percentile points higher than salary.`,
  overpaid: `Salary ranks at least ${GAP_POINTS} percentile points higher than MVP score.`,
  fair: `The two ranks are within ${GAP_POINTS} percentile points of each other.`,
};

// Under each legend entry: the rule in a few words.
const CATEGORY_SHORT: Record<ValueCategory, string> = {
  mvp: `Top ${MVP_CANDIDATE_RANK} MVP score`,
  undervalued: "Score rank ≫ salary rank",
  overpaid: "Salary rank ≫ score rank",
  fair: `Within ${GAP_POINTS} points`,
};

// The steps behind MVP score, in the order the dbt model applies them.
const SCORING_STEPS = [
  {
    title: "Game Score",
    detail:
      "One number per game from points, shooting, rebounds, assists, steals, blocks, turnovers.",
  },
  { title: "Win or loss", detail: "Nudged up after a win, down after a loss." },
  { title: "Season average", detail: "Averaged across every game they played." },
  { title: "Availability", detail: "A penalty for games missed." },
];

/** What MVP score is and what each colour means, opened from "How it's scored". */
function ScoringPanel({ id, medianScore }: { id: string; medianScore: number }) {
  return (
    <div
      id={id}
      className="mt-3 grid gap-x-10 gap-y-6 border-y border-rule-strong py-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
    >
      <div>
        <p className="type-caption mb-3">MVP score, in four steps</p>
        <ol className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
          {SCORING_STEPS.map((step, index) => (
            <li key={step.title} className="border-t border-rule-strong pt-2">
              <p className="type-caption tabular">{index + 1}</p>
              <p className="font-semibold">{step.title}</p>
              <p className="text-sm text-ink-2">{step.detail}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-ink-2">
          Higher is better. The league median is {formatStat(medianScore)}.
        </p>
      </div>
      <div>
        <p className="type-caption mb-3">The colours compare two ranks: MVP score and salary</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {VALUE_CATEGORIES.map((category) => (
            <div key={category.key} className="contents">
              <dt className="flex items-center gap-2 font-semibold whitespace-nowrap">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ background: category.color }}
                />
                {category.label}
              </dt>
              <dd className="text-ink-2">{CATEGORY_RULES[category.key]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function toggled(set: ReadonlySet<string>, value: string) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function PlayerValuePlot({ season, enabled }: { season: string; enabled: boolean }) {
  const [teams, setTeams] = useState<ReadonlySet<string>>(new Set());
  const [players, setPlayers] = useState<ReadonlySet<string>>(new Set());
  const [explainOpen, setExplainOpen] = useState(false);
  const explainId = useId();

  const valueQuery = useQuery({
    queryKey: ["player-value", season],
    queryFn: () => api.listPlayerValue(season || undefined),
    enabled,
  });

  const rows = useMemo(() => valueQuery.data?.data ?? [], [valueQuery.data]);
  const points = useMemo(() => playerValuePoints(rows), [rows]);
  const medianScore = useMemo(() => median(points.map((point) => point.mvp_score)), [points]);
  const teamOptions = useMemo(
    () =>
      [...new Set(points.flatMap((point) => point.team_abbreviation ?? []))].sort((left, right) =>
        left.localeCompare(right)
      ),
    [points]
  );
  const pickedPlayers = points.filter((point) => players.has(point.player_id));
  const picking = teams.size > 0 || players.size > 0;

  if (!enabled || valueQuery.isPending) {
    return <LoadingState label="Loading value plot…" />;
  }
  if (valueQuery.isError) {
    return <ErrorState message={queryErrorMessage(valueQuery.error)} />;
  }
  // No scored season with salaries yet: the table below still has the directory.
  if (points.length === 0) return null;

  return (
    // The rule underneath separates the plot from the directory's own filters.
    <section aria-labelledby="player-value-heading" className="border-b border-rule pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="player-value-heading" className="type-module">
            Production vs Salary
          </h2>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-ink-2">
            <span>
              Each dot is a player. Higher is more production, further right is a bigger salary.
            </span>
            <button
              type="button"
              aria-expanded={explainOpen}
              aria-controls={explainId}
              onClick={() => setExplainOpen((open) => !open)}
              className="text-primary underline decoration-dotted underline-offset-4"
            >
              How it&apos;s scored <span aria-hidden>{explainOpen ? "▲" : "▼"}</span>
            </button>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* One highlight at a time: picking a team or a player replaces
              whatever was picked before, so the plot never mixes selections. */}
          <select
            aria-label="Highlight a team"
            className={cn("field", teams.size > 0 && "field-query")}
            value={[...teams][0] ?? ""}
            onChange={(event) => {
              setPlayers(new Set());
              setTeams(new Set(event.target.value ? [event.target.value] : []));
            }}
          >
            <option value="">Highlight team…</option>
            {teamOptions.map((abbreviation) => (
              <option key={abbreviation} value={abbreviation}>
                {abbreviation}
              </option>
            ))}
          </select>
          <PlayerPicker
            points={points}
            onPick={(playerId) => {
              setTeams(new Set());
              setPlayers(new Set([playerId]));
            }}
          />
        </div>
      </div>

      {explainOpen ? <ScoringPanel id={explainId} medianScore={medianScore} /> : null}

      {picking ? (
        <ul className="mt-3 flex flex-wrap items-center gap-2" aria-label="Highlighted">
          {[...teams].sort().map((abbreviation) => (
            <li key={abbreviation}>
              <Chip
                label={abbreviation}
                onRemove={() => setTeams((current) => toggled(current, abbreviation))}
              />
            </li>
          ))}
          {pickedPlayers.map((point) => (
            <li key={point.player_id}>
              <Chip
                label={point.full_name}
                onRemove={() => setPlayers((current) => toggled(current, point.player_id))}
              />
            </li>
          ))}
          <li>
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => {
                setTeams(new Set());
                setPlayers(new Set());
              }}
            >
              Clear
            </button>
          </li>
        </ul>
      ) : null}

      <div className="mt-3">
        <PlayerValueScatter points={points} teams={teams} players={players} />
      </div>

      <div className="mt-2 flex flex-wrap items-start gap-x-6 gap-y-2 text-sm">
        {VALUE_CATEGORIES.map((category) => (
          <span key={category.key} className="flex flex-col">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block size-2.5 rounded-full"
                style={{ background: category.color }}
              />
              {category.label}
              <span className="tabular text-ink-3">
                {points.filter((point) => point.category === category.key).length}
              </span>
            </span>
            <span className="type-caption pl-4">{CATEGORY_SHORT[category.key]}</span>
          </span>
        ))}
        <span className="type-caption ml-auto self-center">
          Hover a dot for the player · click to open
        </span>
      </div>
    </section>
  );
}

// Owns its own text so a keystroke re-renders this box, not the plot beside
// it: redrawing a few hundred SVG dots per character made typing crawl.
function PlayerPicker({
  points,
  onPick,
}: {
  points: PlayerValuePoint[];
  onPick: (playerId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const byName = useMemo(
    () => new Map(points.map((point) => [foldName(point.full_name), point])),
    [points]
  );
  return (
    <>
      <input
        aria-label="Highlight a player"
        list="player-value-names"
        className="field w-48"
        placeholder="Highlight player…"
        value={search}
        onChange={(event) => {
          const match = byName.get(foldName(event.target.value));
          if (!match) {
            setSearch(event.target.value);
            return;
          }
          // A full name, typed or chosen from the list: pin it and clear the box.
          onPick(match.player_id);
          setSearch("");
        }}
      />
      <datalist id="player-value-names">
        {points.map((point) => (
          <option key={point.player_id} value={point.full_name} />
        ))}
      </datalist>
    </>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 border border-rule px-2 py-0.5 text-sm">
      {label}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        className="text-ink-3 hover:text-foreground"
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  );
}
