"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { StatBarChart } from "@/components/charts/stat-bar-chart";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import {
  formatBirthDate,
  formatDate,
  formatNumber,
  formatStat,
  formatSignedMargin,
  formatUsdCompact,
  locationLabel,
} from "@/lib/format";
import { withSeason } from "@/lib/nav";
import type { GameLogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
type SortKey =
  | "game_date"
  | "points"
  | "rebounds"
  | "assists"
  | "steals"
  | "blocks"
  | "turnovers"
  | "plus_minus"
  | "mvp_game_score"
  | "minutes";

export default function PlayerProfilePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading player…" />}>
      <PlayerProfile />
    </Suspense>
  );
}

function PlayerProfile() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const playerId = params.id;
  const { season } = useSeason();
  const [sortKey, setSortKey] = useState<SortKey>("game_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [b2bOnly, setB2bOnly] = useState(false);
  const [page, setPage] = useState(0);

  const playerQuery = useQuery({
    queryKey: ["player", playerId],
    queryFn: () => api.getPlayer(playerId),
    enabled: Boolean(playerId),
  });
  const b2bQuery = useQuery({
    queryKey: ["player", playerId, "b2b"],
    queryFn: () => api.getPlayerBackToBacks(playerId),
    enabled: Boolean(playerId),
  });
  const logQuery = useQuery({
    queryKey: ["player", playerId, "log", season, b2bOnly, sortKey, sortDir, page],
    queryFn: () =>
      api.getPlayerGameLog(playerId, {
        season: season || undefined,
        is_back_to_back: b2bOnly ? true : undefined,
        sort: sortKey,
        order: sortDir,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    enabled: Boolean(playerId),
  });
  const recentLogQuery = useQuery({
    queryKey: ["player", playerId, "recent-points", season],
    queryFn: () =>
      api.getPlayerGameLog(playerId, {
        season: season || undefined,
        sort: "game_date",
        order: "desc",
        limit: 10,
        offset: 0,
      }),
    enabled: Boolean(playerId),
  });

  const recentPoints = useMemo(
    () =>
      [...(recentLogQuery.data?.data ?? [])].reverse().map((row) => ({
        date: formatDate(row.game_date).replace(/ \d{4}$/, ""),
        points: row.points ?? 0,
      })),
    [recentLogQuery.data]
  );

  function toggleSort(key: SortKey) {
    setPage(0);
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("desc");
  }

  if (!playerId) {
    return <ErrorState message="Invalid player id." />;
  }

  if (playerQuery.isLoading) {
    return <LoadingState label="Loading player…" />;
  }

  if (playerQuery.isError || !playerQuery.data) {
    return (
      <ErrorState
        message={playerQuery.error ? queryErrorMessage(playerQuery.error) : "Player not found."}
      />
    );
  }

  const player = playerQuery.data;
  const b2b = b2bQuery.data;
  const logs = logQuery.data?.data ?? [];
  const totalLogs = logQuery.data?.meta.total ?? 0;
  const identity = [
    player.team_abbreviation,
    player.jersey_number ? `#${player.jersey_number}` : null,
    player.position,
    player.weight != null ? `${player.weight} lb` : null,
    formatBirthDate(player.birth_date),
    player.is_active ? "Active" : "Inactive",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-8">
      <p className="text-xs text-muted-foreground">
        <Link href="/players" className="hover:text-foreground">
          Players
        </Link>
        {" / "}
        {player.full_name}
      </p>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="type-entity">{player.full_name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {identity.map((item, index) => (
              <span key={`${item}-${index}`} className="inline-flex items-center gap-2">
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                {item}
              </span>
            ))}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push(withSeason(`/players/compare?ids=${playerId}`, season))}
          className="btn-ghost"
        >
          Add to compare
        </button>
      </div>

      <div className="grid gap-6 border-y border-border py-5 lg:grid-cols-[1.35fr_auto_0.9fr]">
        <div>
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Season</p>
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <CareerStat label="Games" value={formatNumber(player.career_games_played)} />
            <CareerStat label="PPG" value={formatStat(player.career_ppg)} />
            <CareerStat label="RPG" value={formatStat(player.career_rpg)} />
            <CareerStat label="APG" value={formatStat(player.career_apg)} />
            <CareerStat
              label={`${player.mvp_season ?? "Season"} MVP rank`}
              value={player.mvp_rank != null ? `#${player.mvp_rank}` : "—"}
            />
          </dl>
        </div>
        <div className="hidden w-px bg-border lg:block" aria-hidden />
        <div>
          <h2 className="text-[11px] tracking-wide text-muted-foreground uppercase">
            Remaining contract
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-4">
            <div className="flex flex-col-reverse">
              <dt className="text-[11px] text-muted-foreground">
                {player.current_contract_season ?? "Season"} salary
              </dt>
              <dd className="type-stat tabular">
                {formatUsdCompact(player.current_season_salary)}
              </dd>
            </div>
            <div className="flex flex-col-reverse">
              <dt className="text-[11px] text-muted-foreground">Remaining guaranteed</dt>
              <dd className="type-stat tabular">
                {formatUsdCompact(player.current_remaining_guaranteed)}
              </dd>
            </div>
          </dl>
          <p className="type-caption mt-3">
            Basketball-Reference remaining-year snapshot, not total earnings.
          </p>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="type-module">Game log</h2>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={b2bOnly}
                onCheckedChange={(checked) => {
                  setB2bOnly(checked);
                  setPage(0);
                }}
              />
              B2B only
            </label>
          </div>
          {logQuery.isLoading ? (
            <LoadingState label="Loading game log…" />
          ) : logQuery.isError ? (
            <ErrorState message={queryErrorMessage(logQuery.error)} />
          ) : logs.length === 0 ? (
            <EmptyState message="No game log for this filter yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <SortHead
                      active={sortKey === "game_date"}
                      dir={sortDir}
                      onClick={() => toggleSort("game_date")}
                    >
                      Date
                    </SortHead>
                    <th>Opp</th>
                    <th>Loc</th>
                    <th>Res</th>
                    <SortHead
                      active={sortKey === "minutes"}
                      dir={sortDir}
                      onClick={() => toggleSort("minutes")}
                    >
                      Min
                    </SortHead>
                    <SortHead
                      active={sortKey === "points"}
                      dir={sortDir}
                      onClick={() => toggleSort("points")}
                    >
                      Pts
                    </SortHead>
                    <SortHead
                      active={sortKey === "rebounds"}
                      dir={sortDir}
                      onClick={() => toggleSort("rebounds")}
                    >
                      Reb
                    </SortHead>
                    <SortHead
                      active={sortKey === "assists"}
                      dir={sortDir}
                      onClick={() => toggleSort("assists")}
                    >
                      Ast
                    </SortHead>
                    <SortHead
                      active={sortKey === "steals"}
                      dir={sortDir}
                      onClick={() => toggleSort("steals")}
                    >
                      Stl
                    </SortHead>
                    <SortHead
                      active={sortKey === "blocks"}
                      dir={sortDir}
                      onClick={() => toggleSort("blocks")}
                    >
                      Blk
                    </SortHead>
                    <SortHead
                      active={sortKey === "turnovers"}
                      dir={sortDir}
                      onClick={() => toggleSort("turnovers")}
                    >
                      Tov
                    </SortHead>
                    <SortHead
                      active={sortKey === "plus_minus"}
                      dir={sortDir}
                      onClick={() => toggleSort("plus_minus")}
                    >
                      +/-
                    </SortHead>
                    <SortHead
                      active={sortKey === "mvp_game_score"}
                      dir={sortDir}
                      onClick={() => toggleSort("mvp_game_score")}
                    >
                      MVP
                    </SortHead>
                    <th>B2B</th>
                    <th>PBP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row, index) => (
                    <LogRow key={`${row.game_id ?? row.game_date}-${index}`} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Sortable on any column. Paginated at {PAGE_SIZE} rows.
            {totalLogs
              ? ` ${page * PAGE_SIZE + 1}–${Math.min(totalLogs, (page + 1) * PAGE_SIZE)} of ${totalLogs}.`
              : ""}
          </p>
          {totalLogs > PAGE_SIZE ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                className="btn-ghost"
              >
                ← Prev
              </button>
              <button
                type="button"
                disabled={(page + 1) * PAGE_SIZE >= totalLogs}
                onClick={() => setPage((current) => current + 1)}
                className="btn-ghost"
              >
                Next →
              </button>
            </div>
          ) : null}
        </section>

        <aside className="space-y-8 lg:border-l lg:border-border lg:pl-8">
          <div>
            <h2 className="type-module">Back-to-back splits</h2>
            {b2bQuery.isLoading ? (
              <LoadingState />
            ) : b2bQuery.isError ? (
              <ErrorState message={queryErrorMessage(b2bQuery.error)} />
            ) : !b2b ? (
              <EmptyState message="No back-to-back stats yet for this player." />
            ) : (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <CareerStat label="Back-to-backs" value={formatNumber(b2b.total_back_to_backs)} />
                  <CareerStat
                    label="Games played in B2B"
                    value={formatNumber(b2b.games_played_in_b2b)}
                  />
                </div>
                <SplitBar label="Avg PTS — non-B2B" value={b2b.avg_pts_non_b2b} max={30} />
                <SplitBar label="Avg PTS — on B2B" value={b2b.avg_pts_b2b} max={30} />
                {b2b.avg_pts_b2b != null && b2b.avg_pts_non_b2b != null ? (
                  <p
                    className={cn(
                      "text-sm",
                      b2b.avg_pts_b2b - b2b.avg_pts_non_b2b < 0
                        ? "text-destructive"
                        : "text-primary"
                    )}
                  >
                    {`${(b2b.avg_pts_b2b - b2b.avg_pts_non_b2b).toFixed(1)} PTS on the second night.`}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div>
            <h2 className="type-module">Points in last 10 games</h2>
            <p className="type-caption mt-1">Oldest to newest in the selected season.</p>
            <div className="mt-3">
              {recentLogQuery.isLoading ? (
                <LoadingState />
              ) : recentLogQuery.isError ? (
                <EmptyState title="No recent points" message="No recent game log to chart yet." />
              ) : (
                <StatBarChart
                  data={recentPoints}
                  xKey="date"
                  bars={[{ dataKey: "points", fill: "#2D5A27", name: "Points" }]}
                />
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CareerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="type-hero-stat tabular">{value}</dd>
    </div>
  );
}

function SplitBar({ label, value, max }: { label: string; value: number | null; max: number }) {
  const width = value == null ? 0 : Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular text-foreground">{formatStat(value)}</span>
      </div>
      <div className="h-2 bg-skel-1">
        <div className="h-full bg-primary" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function SortHead({
  children,
  active,
  dir,
  onClick,
}: {
  children: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th data-active={active ? "true" : undefined}>
      <button type="button" className="inline-flex items-center gap-1" onClick={onClick}>
        {children}
        {active ? <span>{dir === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    </th>
  );
}

function LogRow({ row }: { row: GameLogEntry }) {
  const win = row.result.toUpperCase().startsWith("W");
  const loss = row.result.toUpperCase().startsWith("L");
  return (
    <tr className={row.is_back_to_back ? "bg-row-b2b" : undefined}>
      <td className="tabular">{formatDate(row.game_date)}</td>
      <td className="font-semibold">{row.opponent_abbreviation}</td>
      <td>{locationLabel(row.location)}</td>
      <td className={cn("font-medium", win && "text-primary", loss && "text-destructive")}>
        {row.result || "—"}
      </td>
      <td className="tabular text-right">{formatStat(row.minutes, 1)}</td>
      <td className="tabular text-right">{formatNumber(row.points)}</td>
      <td className="tabular text-right">{formatNumber(row.rebounds)}</td>
      <td className="tabular text-right">{formatNumber(row.assists)}</td>
      <td className="tabular text-right">{formatNumber(row.steals)}</td>
      <td className="tabular text-right">{formatNumber(row.blocks)}</td>
      <td className="tabular text-right">{formatNumber(row.turnovers)}</td>
      <td className="tabular text-right">{formatSignedMargin(row.plus_minus)}</td>
      <td className="tabular text-right">{formatStat(row.mvp_game_score)}</td>
      <td className="text-muted-foreground">{row.is_back_to_back ? "B2B" : "—"}</td>
      <td>
        {row.game_id ? (
          <Link
            href={withSeason(`/games/${row.game_id}`, row.season ?? "")}
            className="text-primary hover:underline"
          >
            PBP
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}
