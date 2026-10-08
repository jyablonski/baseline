"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamAbbrLink } from "@/components/team-logo";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import {
  formatMoneyline,
  formatProbability,
  formatScheduleDate,
  formatSpread,
  formatTimeET,
} from "@/lib/format";
import { teamHref, withSeason } from "@/lib/nav";
import type { ScheduledGame } from "@/lib/types";

// One request covers the day on screen and reaches the next one: a full slate
// is 15 games, so the first row dated later is always inside this window.
const FETCH_LIMIT = 50;

export default function SchedulePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading schedule…" />}>
      <ScheduleBody />
    </Suspense>
  );
}

function ScheduleBody() {
  const { season, isLoading: seasonIsLoading } = useSeason();
  // The days paged through so far, oldest first; empty means the first day with
  // a game from today onward. Prev pops back through the same days, so off days
  // are skipped in both directions.
  const [days, setDays] = useState<string[]>([]);
  const day = days.at(-1);

  const scheduleQuery = useQuery({
    queryKey: ["schedule", season, day ?? "next"],
    queryFn: () =>
      api.listSchedule({
        season: season || undefined,
        status: "Scheduled",
        from_date: day,
        limit: FETCH_LIMIT,
      }),
    enabled: !seasonIsLoading,
  });

  const fetched = scheduleQuery.data?.data ?? [];
  const shownDay = fetched[0]?.game_date.slice(0, 10);
  const rows = fetched.filter((game) => game.game_date.slice(0, 10) === shownDay);
  const nextDay = fetched[rows.length]?.game_date.slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-page">Schedule</h1>
          <p className="mt-1 text-sm text-ink-2">
            {season ? `${season} schedule` : "Upcoming schedule"} from today onward. TV lists
            national broadcasts only. Win % is Baseline&apos;s pregame model estimate.{" "}
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
                <th>Date / time (ET)</th>
                <th>Matchup</th>
                <th title="National TV and streaming">TV</th>
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

      {rows.length > 0 || days.length > 0 ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            {rows.length > 0
              ? `${formatScheduleDate(shownDay)} · ${rows.length} ${rows.length === 1 ? "game" : "games"}`
              : ""}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={days.length === 0}
              onClick={() => setDays((current) => current.slice(0, -1))}
              className="btn-ghost"
            >
              ← Prev day
            </button>
            <button
              type="button"
              disabled={!nextDay}
              onClick={() => nextDay && setDays((current) => [...current, nextDay])}
              className="btn-ghost"
            >
              Next day →
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
      <td className="tabular whitespace-nowrap">
        <span className="block">{formatScheduleDate(game.game_date)}</span>
        <span className="block text-xs text-muted-foreground">
          {formatTimeET(game.start_time_et)}
        </span>
      </td>
      <td>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {game.away_team_id ? (
            <TeamAbbrLink
              teamId={game.away_team_id}
              abbreviation={away}
              href={withSeason(teamHref(game.away_team_name ?? away), season)}
            />
          ) : (
            <span className="font-semibold">{away}</span>
          )}
          <span className="text-muted-foreground">@</span>
          {game.home_team_id ? (
            <TeamAbbrLink
              teamId={game.home_team_id}
              abbreviation={home}
              href={withSeason(teamHref(game.home_team_name ?? home), season)}
            />
          ) : (
            <span className="font-semibold">{home}</span>
          )}
        </span>
      </td>
      <td className="whitespace-nowrap" data-testid="national-tv">
        {game.national_tv || "—"}
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
