"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamAbbrLink } from "@/components/team-logo";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import {
  formatDate,
  formatMoneyline,
  formatNumber,
  formatProbability,
  formatSpread,
} from "@/lib/format";
import { withSeason } from "@/lib/nav";
import type { ScheduledGame } from "@/lib/types";

const PAGE_SIZE = 50;

export default function SchedulePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading schedule…" />}>
      <ScheduleBody />
    </Suspense>
  );
}

function ScheduleBody() {
  const { season } = useSeason();
  const [page, setPage] = useState(0);

  const scheduleQuery = useQuery({
    queryKey: ["schedule", season, page],
    queryFn: () =>
      api.listSchedule({
        season: season || undefined,
        status: "Scheduled",
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });

  const rows = scheduleQuery.data?.data ?? [];
  const total = scheduleQuery.data?.meta.total ?? 0;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-page">Schedule</h1>
          <p className="mt-1 text-sm text-ink-2">
            Scheduled games from today onward. Scores stay empty until the game is Final.
          </p>
          <p className="mt-1 text-sm text-ink-2">
            Win % is Baseline&apos;s pregame model estimate. Moneyline and spread are a consensus of
            US sportsbook odds. Both are for context, not betting advice.{" "}
            <Link href="/predictions" className="underline underline-offset-2">
              How accurate is the model?
            </Link>
          </p>
        </div>
      </div>

      {scheduleQuery.isLoading ? (
        <LoadingState label="Loading upcoming games…" />
      ) : scheduleQuery.isError ? (
        <ErrorState message={queryErrorMessage(scheduleQuery.error)} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No upcoming games"
          message={`No scheduled games for ${season || "this season"} yet.`}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Matchup</th>
                <th title="Pregame model estimate, away / home">Win % (away / home)</th>
                <th title="Consensus moneyline, away / home">Moneyline</th>
                <th title="Consensus home spread">Spread</th>
                <th>Status</th>
                <th>Arena</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((game) => (
                <ScheduleRow key={game.game_id} game={game} season={season} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            {from}–{to} of {formatNumber(total)} games
          </p>
          <div className="flex gap-2">
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
              disabled={to >= total}
              onClick={() => setPage((current) => current + 1)}
              className="btn-ghost"
            >
              Next →
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ScheduleRow({ game, season }: { game: ScheduledGame; season: string }) {
  const away = game.away_team_abbreviation ?? "Away";
  const home = game.home_team_abbreviation ?? "Home";
  const arena = game.arena || game.arena_city || "—";
  return (
    <tr>
      <td className="tabular whitespace-nowrap">{formatDate(game.game_date)}</td>
      <td>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {game.away_team_id ? (
            <TeamAbbrLink
              teamId={game.away_team_id}
              abbreviation={away}
              href={withSeason(`/teams/${game.away_team_id}`, season)}
            />
          ) : (
            <span className="font-semibold">{away}</span>
          )}
          <span className="text-muted-foreground">@</span>
          {game.home_team_id ? (
            <TeamAbbrLink
              teamId={game.home_team_id}
              abbreviation={home}
              href={withSeason(`/teams/${game.home_team_id}`, season)}
            />
          ) : (
            <span className="font-semibold">{home}</span>
          )}
        </span>
      </td>
      <td className="tabular whitespace-nowrap" data-testid="win-probability">
        {pairOrDash(
          formatProbability(game.away_win_probability),
          formatProbability(game.home_win_probability)
        )}
      </td>
      <td className="tabular whitespace-nowrap" data-testid="moneyline">
        {pairOrDash(formatMoneyline(game.away_moneyline), formatMoneyline(game.home_moneyline))}
      </td>
      <td className="tabular whitespace-nowrap" data-testid="spread">
        {game.home_spread == null ? "—" : `${home} ${formatSpread(game.home_spread)}`}
      </td>
      <td>{game.status || "Scheduled"}</td>
      <td>{arena}</td>
    </tr>
  );
}

// One missing side means the pair is not trustworthy; render a single dash.
function pairOrDash(away: string, home: string) {
  if (away === "—" || home === "—") return "—";
  return `${away} / ${home}`;
}
