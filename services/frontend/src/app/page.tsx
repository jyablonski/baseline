"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamAbbrLink } from "@/components/team-logo";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import {
  formatDate,
  formatNumber,
  formatRecord,
  formatSeasonType,
  formatSignedMargin,
  formatWinPctPlain,
} from "@/lib/format";
import { withSeason } from "@/lib/nav";
import { standingsSeed } from "@/lib/team-form";
import { cn } from "@/lib/utils";
import type { LeagueGame, StandingRow } from "@/lib/types";

export default function HomePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading desk…" />}>
      <HomeDesk />
    </Suspense>
  );
}

function HomeDesk() {
  const { season } = useSeason();

  const statusQuery = useQuery({
    queryKey: ["status"],
    queryFn: () => api.getStatus(),
  });
  const gamesQuery = useQuery({
    queryKey: ["games", season, "latest"],
    queryFn: () =>
      api.listGames({
        season: season || undefined,
        limit: 10,
      }),
  });
  const standingsQuery = useQuery({
    queryKey: ["standings", season],
    queryFn: () => api.listStandings({ season: season || undefined }),
  });

  const status = statusQuery.data;
  const coverageSeason = status?.last_season ?? season ?? "—";
  const players = statusQuery.isError ? "—" : formatNumber(status?.player_count);
  const games = statusQuery.isError ? "—" : formatNumber(status?.game_count);

  const east = topConference(standingsQuery.data?.data ?? [], "east");
  const west = topConference(standingsQuery.data?.data ?? [], "west");

  return (
    <div className="flex flex-col gap-[34px]">
      <section className="space-y-3">
        <h1 className="type-page">Box scores, game logs, and splits.</h1>
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
          <Fact label="Coverage" value={coverageSeason} />
          <Fact label="Players in directory" value={statusQuery.isPending ? "—" : players} />
          <Fact label="Games" value={statusQuery.isPending ? "—" : games} />
        </dl>
      </section>

      <div className="grid gap-[26px] lg:grid-cols-[7fr_5fr] lg:gap-0">
        <section className="lg:pr-[26px]">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="type-module">Latest games</h2>
            </div>
          </div>
          {gamesQuery.isLoading ? (
            <LoadingState label="Loading recent games…" />
          ) : gamesQuery.isError ? (
            <ErrorState message={queryErrorMessage(gamesQuery.error)} />
          ) : (gamesQuery.data?.data ?? []).length === 0 ? (
            <EmptyState message="No games yet for this season." />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Matchup</th>
                  <th>Score</th>
                  <th>Margin</th>
                  <th>Arena city</th>
                  <th>PBP</th>
                </tr>
              </thead>
              <tbody>
                {(gamesQuery.data?.data ?? []).map((game) => (
                  <GameRow key={game.game_id} game={game} season={season} />
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-4 text-sm">
            <Link href="/games" className="text-primary hover:underline">
              PBP game flow →
            </Link>
            <span className="px-2 text-ink-3">·</span>
            <Link href="/players" className="text-primary hover:underline">
              Back-to-back splits live on player profiles →
            </Link>
          </p>
        </section>

        <section className="lg:border-l lg:border-rule lg:pl-[26px]">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="type-module">Standings snapshot</h2>
            <Link
              href={withSeason("/standings", season)}
              className="text-sm text-ink-2 hover:text-foreground"
            >
              Full standings →
            </Link>
          </div>
          {standingsQuery.isLoading ? (
            <LoadingState label="Loading standings…" />
          ) : standingsQuery.isError ? (
            <ErrorState message={queryErrorMessage(standingsQuery.error)} />
          ) : east.length === 0 && west.length === 0 ? (
            <EmptyState
              title="No standings yet"
              message={`No Regular Season games or official standings for ${season || "this season"}.`}
            />
          ) : (
            <div className="grid grid-cols-2 gap-6">
              <SnapshotColumn title="East" rows={east} season={season} />
              <SnapshotColumn title="West" rows={west} season={season} />
            </div>
          )}
          <p className="type-caption mt-4">
            Standings: rank, W–L, win %, GB, streak, last-10, as-of date.
          </p>
        </section>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 after:ml-4 after:h-3 after:w-px after:bg-border last:after:hidden">
      <dt>{label}:</dt>
      <dd className="tabular font-medium text-foreground">{value}</dd>
    </div>
  );
}

function GameRow({ game, season }: { game: LeagueGame; season: string }) {
  const away = game.away_team_abbreviation ?? "Away";
  const home = game.home_team_abbreviation ?? "Home";
  const score =
    game.away_score != null && game.home_score != null
      ? `${game.away_score}–${game.home_score}`
      : "—";
  const margin =
    game.score_margin != null
      ? formatSignedMargin(game.score_margin)
      : game.away_score != null && game.home_score != null
        ? formatSignedMargin(Math.abs(game.away_score - game.home_score))
        : "—";
  return (
    <tr>
      <td className="tabular whitespace-nowrap">{formatDate(game.game_date)}</td>
      <td className="whitespace-nowrap text-muted-foreground">
        {formatSeasonType(game.season_type)}
      </td>
      <td>
        <Link
          href={withSeason(`/teams/${game.away_team_id ?? ""}`, season)}
          className="font-semibold text-primary hover:underline"
        >
          {away}
        </Link>
        <span className="px-1 text-muted-foreground">at</span>
        <Link
          href={withSeason(`/teams/${game.home_team_id ?? ""}`, season)}
          className="font-semibold text-primary hover:underline"
        >
          {home}
        </Link>
      </td>
      <td className="tabular font-semibold">{score}</td>
      <td className="tabular font-semibold">{margin}</td>
      <td className="text-muted-foreground">{game.arena_city ?? "—"}</td>
      <td>
        <Link href={`/games/${game.game_id}`} className="text-primary hover:underline">
          PBP
        </Link>
      </td>
    </tr>
  );
}

// Fixed team column: an auto-width one lets a wider abbreviation shove the
// record out of line with the rows above it.
const SNAPSHOT_GRID =
  "grid grid-cols-[1.2rem_4.25rem_1fr_2.75rem] items-center gap-1 px-0.5 tabular";

function SnapshotColumn({
  title,
  rows,
  season,
}: {
  title: string;
  rows: StandingRow[];
  season: string;
}) {
  return (
    <div>
      <p className="type-eyebrow mb-2">{title}</p>
      <div className={cn(SNAPSHOT_GRID, "type-eyebrow mb-1 text-muted-foreground")}>
        <span />
        <span />
        <span>W–L</span>
        <span className="text-right">Win %</span>
      </div>
      <ol className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <li key={row.team_id} className={cn(SNAPSHOT_GRID, "hover:bg-row-hover")}>
            <span className="text-muted-foreground">{standingsSeed(row) ?? "—"}</span>
            <TeamAbbrLink
              teamId={row.team_id}
              abbreviation={row.abbreviation}
              href={withSeason(`/teams/${row.team_id}`, season)}
            />
            <span className="text-muted-foreground">{formatRecord(row.wins, row.losses)}</span>
            <span className="text-right">{formatWinPctPlain(row.win_pct)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function topConference(rows: StandingRow[], prefix: string) {
  return rows
    .filter((row) => row.conference.toLowerCase().startsWith(prefix))
    .sort(compareSnapshotRows);
}

function compareSnapshotRows(a: StandingRow, b: StandingRow) {
  const seedA = standingsSeed(a);
  const seedB = standingsSeed(b);
  if (seedA != null && seedB != null) {
    return seedA - seedB;
  }
  if (seedA != null) return -1;
  if (seedB != null) return 1;
  const winDiff = (b.win_pct ?? -1) - (a.win_pct ?? -1);
  if (winDiff !== 0) return winDiff;
  return a.team_name.localeCompare(b.team_name);
}
