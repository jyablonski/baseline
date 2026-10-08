"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { PlayerValueScatter } from "@/components/charts/player-value-scatter";
import { ErrorState, LoadingState } from "@/components/query-state";
import { api, queryErrorMessage } from "@/lib/api";
import {
  foldName,
  playerValuePoints,
  VALUE_CATEGORIES,
  type PlayerValuePoint,
} from "@/lib/player-value";
import { cn } from "@/lib/utils";

function toggled(set: ReadonlySet<string>, value: string) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function PlayerValuePlot({ season, enabled }: { season: string; enabled: boolean }) {
  const [teams, setTeams] = useState<ReadonlySet<string>>(new Set());
  const [players, setPlayers] = useState<ReadonlySet<string>>(new Set());

  const valueQuery = useQuery({
    queryKey: ["player-value", season],
    queryFn: () => api.listPlayerValue(season || undefined),
    enabled,
  });

  const rows = useMemo(() => valueQuery.data?.data ?? [], [valueQuery.data]);
  const points = useMemo(() => playerValuePoints(rows), [rows]);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="player-value-heading" className="type-module">
          Production vs Salary
        </h2>
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

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        {VALUE_CATEGORIES.map((category) => (
          <span key={category.key} className="inline-flex items-center gap-1.5">
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
        ))}
        <span className="type-caption ml-auto">Hover a dot for the player · click to open</span>
      </div>
      <p className="type-caption mt-2 max-w-3xl">
        MVP score is a proprietary Baseline metric that combines a player&apos;s aggregated
        box-score production across the season with his team&apos;s results and his availability.
      </p>
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
