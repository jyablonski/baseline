"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";

import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { useDebounce } from "@/hooks/use-debounce";
import { api, queryErrorMessage } from "@/lib/api";
import {
  formatDate,
  formatNumber,
  formatSignedMargin,
  formatStat,
  locationLabel,
  playerSubtitle,
} from "@/lib/format";
import type { HeadToHeadComparison, HeadToHeadPlayerAverages, PlayerComparison } from "@/lib/types";
import { cn } from "@/lib/utils";

type CompareView = "career" | "h2h";

const STAT_OPTIONS = [
  { value: "games_played", label: "Games" },
  { value: "ppg", label: "PPG" },
  { value: "rpg", label: "RPG" },
  { value: "apg", label: "APG" },
  { value: "plus_minus", label: "+/-" },
  { value: "mvp", label: "MVP" },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function ComparePlayersPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading comparison…" />}>
      <ComparePlayers />
    </Suspense>
  );
}

function ComparePlayers() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idsParam = searchParams.get("ids") ?? "";
  const statParam = searchParams.get("stat") ?? "games_played";
  const viewParam = searchParams.get("view") === "h2h" ? "h2h" : "career";
  // MVP columns follow ?season=; without it the API uses the latest scored season.
  const seasonParam = searchParams.get("season") ?? "";
  const [stat, setStat] = useState(statParam);
  const [view, setView] = useState<CompareView>(viewParam);
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const debouncedAdd = useDebounce(addSearch, 250);

  const ids = useMemo(
    () =>
      idsParam
        .split(",")
        .map((part) => part.trim())
        .filter((id) => UUID_RE.test(id)),
    [idsParam]
  );

  const canH2h = ids.length === 2;
  const activeView: CompareView = canH2h ? view : "career";

  const compareQuery = useQuery({
    queryKey: ["players", "compare", ids, stat, seasonParam],
    queryFn: () => api.comparePlayers(ids, stat, seasonParam || undefined),
    enabled: ids.length >= 2 && activeView === "career",
  });
  const h2hQuery = useQuery({
    queryKey: ["players", "compare", "h2h", ids],
    queryFn: () => api.comparePlayersHeadToHead(ids),
    enabled: canH2h && activeView === "h2h",
  });
  const addQuery = useQuery({
    queryKey: ["players", "add", debouncedAdd],
    queryFn: () => api.searchPlayers(debouncedAdd.trim(), { limit: 8 }),
    enabled: addOpen && debouncedAdd.trim().length > 0,
  });
  const chipQueries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["player", id],
      queryFn: () => api.getPlayer(id),
    })),
  });

  const rows = compareQuery.data?.data ?? [];
  const chipNames = new Map<string, string>();
  for (const row of rows) {
    chipNames.set(row.player_id, row.full_name);
  }
  for (const result of chipQueries) {
    if (result.data) chipNames.set(result.data.player_id, result.data.full_name);
  }

  function replaceIds(next: string[], nextStat = stat, nextView: CompareView = view) {
    const params = new URLSearchParams();
    if (next.length) params.set("ids", next.join(","));
    params.set("stat", nextStat);
    if (seasonParam) params.set("season", seasonParam);
    if (next.length === 2 && nextView === "h2h") params.set("view", "h2h");
    router.replace(`/players/compare?${params.toString()}`);
  }

  function setCompareView(next: CompareView) {
    setView(next);
    replaceIds(ids, stat, next);
  }

  function removeId(id: string) {
    const next = ids.filter((item) => item !== id);
    if (next.length !== 2) setView("career");
    replaceIds(next);
  }

  function addId(id: string) {
    if (ids.includes(id)) return;
    replaceIds([...ids, id]);
    setAddSearch("");
    setAddOpen(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/players" className="type-timestamp hover:underline">
          ← Players
        </Link>
        <h1 className="type-page mt-1">Compare players</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ids.map((id, index) => {
          const player = chipQueries[index]?.data;
          const subtitle = playerSubtitle(player?.team_abbreviation, player?.position);
          return (
            <Chip
              key={id}
              label={chipNames.get(id) ?? "Loading player"}
              subtitle={subtitle}
              onRemove={() => removeId(id)}
            />
          );
        })}
        <button
          type="button"
          onClick={() => setAddOpen((open) => !open)}
          className="h-8 border border-dashed border-border px-3 text-sm text-muted-foreground"
        >
          + Add player
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {canH2h ? (
            <div className="flex border border-border" role="group" aria-label="Compare mode">
              <button
                type="button"
                onClick={() => setCompareView("career")}
                className={cn("seg-btn", activeView === "career" && "seg-btn-active")}
              >
                Season
              </button>
              <button
                type="button"
                onClick={() => setCompareView("h2h")}
                className={cn("seg-btn", activeView === "h2h" && "seg-btn-active")}
              >
                Head-to-head
              </button>
            </div>
          ) : null}
          {activeView === "career" ? (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Sort by
              <select
                className="field"
                value={stat}
                onChange={(event) => {
                  const next = event.target.value;
                  setStat(next);
                  replaceIds(ids, next);
                }}
              >
                {STAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {addOpen ? (
        <form
          className="max-w-sm space-y-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const first = addQuery.data?.data[0];
            if (first) addId(first.player_id);
          }}
        >
          <input
            value={addSearch}
            onChange={(event) => setAddSearch(event.target.value)}
            placeholder="Search directory"
            className={cn("field w-full", addSearch.trim() && "field-query")}
          />
          {(addQuery.data?.data ?? [])
            .filter((player) => !ids.includes(player.player_id))
            .map((player) => (
              <button
                key={player.player_id}
                type="button"
                onClick={() => addId(player.player_id)}
                className="block w-full border-b border-border py-1.5 text-left text-sm hover:bg-row-hover hover:text-primary"
              >
                {player.full_name}
                {player.team_abbreviation ? (
                  <span className="ml-2 text-muted-foreground">{player.team_abbreviation}</span>
                ) : null}
              </button>
            ))}
        </form>
      ) : null}

      {ids.length < 2 ? (
        <div className="border border-border px-6 py-16 text-center">
          <p className="font-semibold">Select two players from the directory.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Check names in Players, or add them from a profile.
          </p>
        </div>
      ) : activeView === "h2h" ? (
        <HeadToHeadPanel query={h2hQuery} />
      ) : compareQuery.isLoading ? (
        <LoadingState label="Loading comparison…" />
      ) : compareQuery.isError ? (
        <ErrorState message={queryErrorMessage(compareQuery.error)} />
      ) : rows.length === 0 ? (
        <EmptyState message="Nothing to compare yet." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <SortHead active={stat === "games_played"}>Games</SortHead>
                  <SortHead active={stat === "ppg"}>PPG</SortHead>
                  <SortHead active={stat === "rpg"}>RPG</SortHead>
                  <SortHead active={stat === "apg"}>APG</SortHead>
                  <SortHead active={stat === "plus_minus"}>+/-</SortHead>
                  <SortHead active={stat === "mvp"}>MVP</SortHead>
                  <th>Playoff MVP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.player_id}>
                    <td className="py-3">
                      <Link
                        href={`/players/${row.player_id}`}
                        className="text-lg font-semibold hover:text-primary"
                      >
                        {row.full_name}
                      </Link>
                      {playerSubtitle(row.team_abbreviation, row.position) ? (
                        <p className="text-xs text-muted-foreground">
                          {playerSubtitle(row.team_abbreviation, row.position)}
                        </p>
                      ) : null}
                    </td>
                    <CompareStat
                      value={formatNumber(row.career_games_played)}
                      emphasize={stat === "games_played"}
                    />
                    <CompareStat value={formatStat(row.career_ppg)} emphasize={stat === "ppg"} />
                    <CompareStat value={formatStat(row.career_rpg)} emphasize={stat === "rpg"} />
                    <CompareStat value={formatStat(row.career_apg)} emphasize={stat === "apg"} />
                    <CompareStat
                      value={formatSignedMargin(row.career_avg_plus_minus, 1)}
                      emphasize={stat === "plus_minus"}
                    />
                    <MvpStat score={row.mvp_score} rank={row.mvp_rank} emphasize={stat === "mvp"} />
                    <MvpStat
                      score={row.playoff_mvp_score}
                      rank={row.playoff_mvp_rank}
                      emphasize={false}
                    />
                  </tr>
                ))}
                {rows.length === 2 ? <DifferenceRow a={rows[0]} b={rows[1]} /> : null}
              </tbody>
            </table>
          </div>
          {rows[0]?.mvp_season ? (
            <p className="type-caption">
              MVP and Playoff MVP cover the {rows[0].mvp_season} regular season and playoffs, with
              league rank. Scores weigh box-score production, wins, and games missed.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function Chip({
  label,
  subtitle,
  onRemove,
}: {
  label: string;
  subtitle?: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex min-h-8 items-center gap-2 border border-border bg-surface px-2.5 py-1 text-sm">
      <span>
        {label}
        {subtitle ? <span className="ml-2 text-xs text-muted-foreground">{subtitle}</span> : null}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="text-muted-foreground"
      >
        ×
      </button>
    </span>
  );
}

function SortHead({ children, active }: { children: string; active: boolean }) {
  return (
    <th data-active={active ? "true" : undefined}>
      {children}
      {active ? <span className="ml-1">↓</span> : null}
    </th>
  );
}

function CompareStat({ value, emphasize }: { value: string; emphasize: boolean }) {
  return (
    <td className={cn("tabular py-3 text-right", emphasize && "text-lg font-semibold")}>{value}</td>
  );
}

function MvpStat({
  score,
  rank,
  emphasize,
}: {
  score: number | null | undefined;
  rank: number | null | undefined;
  emphasize: boolean;
}) {
  return (
    <td className={cn("tabular py-3 text-right", emphasize && "text-lg font-semibold")}>
      {formatStat(score)}
      {rank != null ? (
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">#{rank}</span>
      ) : null}
    </td>
  );
}

function DifferenceRow({ a, b }: { a: PlayerComparison; b: PlayerComparison }) {
  const games = a.career_games_played - b.career_games_played;
  const ppg = (a.career_ppg ?? 0) - (b.career_ppg ?? 0);
  const rpg = (a.career_rpg ?? 0) - (b.career_rpg ?? 0);
  const apg = (a.career_apg ?? 0) - (b.career_apg ?? 0);
  return (
    <tr>
      <td className="py-3 text-muted-foreground">Difference</td>
      <td className="tabular py-3 text-right text-primary">{signed(games, 0)}</td>
      <td className="tabular py-3 text-right text-primary">{signed(ppg, 1)}</td>
      <td className="tabular py-3 text-right text-primary">{signed(rpg, 1)}</td>
      <td className="tabular py-3 text-right text-primary">{signed(apg, 1)}</td>
      <td className="tabular py-3 text-right text-primary">
        {signedNullable(a.career_avg_plus_minus, b.career_avg_plus_minus, 1)}
      </td>
      <td className="tabular py-3 text-right text-primary">
        {signedNullable(a.mvp_score, b.mvp_score, 1)}
      </td>
      <td className="tabular py-3 text-right text-primary">
        {signedNullable(a.playoff_mvp_score, b.playoff_mvp_score, 1)}
      </td>
    </tr>
  );
}

function signed(value: number, digits: number) {
  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    signDisplay: "exceptZero",
  });
  return formatted;
}

function signedNullable(
  a: number | null | undefined,
  b: number | null | undefined,
  digits: number
) {
  if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return "—";
  return signed(a - b, digits);
}

function HeadToHeadPanel({
  query,
}: {
  query: {
    data?: HeadToHeadComparison;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };
}) {
  if (query.isLoading) {
    return <LoadingState label="Loading head-to-head…" />;
  }
  if (query.isError) {
    return <ErrorState message={queryErrorMessage(query.error)} />;
  }

  const meeting = query.data;
  if (!meeting || meeting.games_played === 0) {
    return <EmptyState message="No head-to-head games to show. Teammate games are not counted." />;
  }

  const [first, second] = meeting.players;

  return (
    <div className="space-y-8">
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Games</th>
              <th>MPG</th>
              <th>PPG</th>
              <th>RPG</th>
              <th>APG</th>
              <th>+/-</th>
            </tr>
          </thead>
          <tbody>
            {meeting.players.map((row) => (
              <tr key={row.player_id}>
                <td className="py-3">
                  <Link
                    href={`/players/${row.player_id}`}
                    className="text-lg font-semibold hover:text-primary"
                  >
                    {row.full_name}
                  </Link>
                </td>
                <CompareStat value={formatNumber(row.games)} emphasize />
                <CompareStat value={formatStat(row.mpg)} emphasize={false} />
                <CompareStat value={formatStat(row.ppg)} emphasize={false} />
                <CompareStat value={formatStat(row.rpg)} emphasize={false} />
                <CompareStat value={formatStat(row.apg)} emphasize={false} />
                <CompareStat value={formatSignedMargin(row.plus_minus, 1)} emphasize={false} />
              </tr>
            ))}
            {first && second ? <H2hDifferenceRow a={first} b={second} /> : null}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Season</th>
              <th>Matchup</th>
              <th>Player</th>
              <th>Loc</th>
              <th>Res</th>
              <th className="text-right">Min</th>
              <th className="text-right">Pts</th>
              <th className="text-right">Reb</th>
              <th className="text-right">Ast</th>
              <th className="text-right">+/-</th>
            </tr>
          </thead>
          <tbody>
            {meeting.games.map((game) =>
              game.lines.map((line, index) => {
                const win = line.result.toUpperCase().startsWith("W");
                const loss = line.result.toUpperCase().startsWith("L");
                return (
                  <tr key={`${game.game_id}-${line.player_id}`}>
                    <td className="tabular">{index === 0 ? formatDate(game.game_date) : ""}</td>
                    <td>{index === 0 ? game.season : ""}</td>
                    <td>{index === 0 ? game.matchup || "—" : ""}</td>
                    <td className="font-semibold">{line.full_name}</td>
                    <td>{locationLabel(line.location)}</td>
                    <td
                      className={cn(
                        "font-medium",
                        win && "text-primary",
                        loss && "text-destructive"
                      )}
                    >
                      {line.result || "—"}
                    </td>
                    <td className="tabular text-right">{formatStat(line.minutes)}</td>
                    <td className="tabular text-right">{formatNumber(line.points)}</td>
                    <td className="tabular text-right">{formatNumber(line.rebounds)}</td>
                    <td className="tabular text-right">{formatNumber(line.assists)}</td>
                    <td className="tabular text-right">{formatSignedMargin(line.plus_minus)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="type-caption">
        Head-to-head games are meetings where the two players were on opposite teams. Teammate boxes
        are not counted.
      </p>
    </div>
  );
}

function H2hDifferenceRow({ a, b }: { a: HeadToHeadPlayerAverages; b: HeadToHeadPlayerAverages }) {
  return (
    <tr>
      <td className="py-3 text-muted-foreground">Difference</td>
      <td className="tabular py-3 text-right text-primary">{signed(a.games - b.games, 0)}</td>
      <td className="tabular py-3 text-right text-primary">
        {signed((a.mpg ?? 0) - (b.mpg ?? 0), 1)}
      </td>
      <td className="tabular py-3 text-right text-primary">
        {signed((a.ppg ?? 0) - (b.ppg ?? 0), 1)}
      </td>
      <td className="tabular py-3 text-right text-primary">
        {signed((a.rpg ?? 0) - (b.rpg ?? 0), 1)}
      </td>
      <td className="tabular py-3 text-right text-primary">
        {signed((a.apg ?? 0) - (b.apg ?? 0), 1)}
      </td>
      <td className="tabular py-3 text-right text-primary">
        {signedNullable(a.plus_minus, b.plus_minus, 1)}
      </td>
    </tr>
  );
}
