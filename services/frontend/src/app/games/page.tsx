"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { DayHeader, DayPicker } from "@/components/day-picker";
import { ResultTags } from "@/components/games/result-tags";
import { SeasonNotables } from "@/components/games/season-notables";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamLogo } from "@/components/team-logo";
import { api, queryErrorMessage } from "@/lib/api";
import { useDayParam } from "@/hooks/use-day-param";
import { dayNavigation } from "@/lib/calendar";
import { daySummary, formatDayTitle, resultSides } from "@/lib/results";
import type { LeagueGame } from "@/lib/types";
import { cn } from "@/lib/utils";

// A full slate is 15 games; this covers any single day.
const DAY_LIMIT = 20;

export default function GamesPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading games…" />}>
      <GamesIndex />
    </Suspense>
  );
}

function GamesIndex() {
  const searchParams = useSearchParams();
  const datesQuery = useQuery({
    queryKey: ["games", "dates"],
    queryFn: () => api.listGameDates(),
  });
  const dates = datesQuery.data?.data ?? [];
  const { current, home: latest, older, newer } = dayNavigation(dates, searchParams.get("date"));
  // Notables follow the newest season with a finished game, not the schedule's:
  // before opening night that is still last season.
  const season = dates[0]?.season ?? "";

  const showDay = useDayParam(latest);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="type-page">Games</h1>
        <p className="mt-1 text-sm text-ink-2">
          Finished games and the season&apos;s standouts. Upcoming games are on the{" "}
          <Link href="/schedule" className="underline underline-offset-2">
            schedule
          </Link>
          .
        </p>
      </div>
      {datesQuery.isPending ? (
        <LoadingState label="Loading games…" />
      ) : datesQuery.isError ? (
        <ErrorState message={queryErrorMessage(datesQuery.error)} />
      ) : !current || !latest ? (
        <EmptyState message="No completed games to show yet." />
      ) : (
        <>
          <ResultsDay
            date={current}
            latest={latest}
            picker={
              <DayPicker
                current={current}
                home={latest}
                homeLabel="Latest"
                older={older}
                newer={newer}
                gameDays={dates.map((item) => item.game_date.slice(0, 10))}
                onPick={showDay}
              />
            }
          />
          <SeasonNotables season={season} />
        </>
      )}
    </div>
  );
}

function ResultsDay({
  date,
  latest,
  picker,
}: {
  date: string;
  latest: string;
  picker: React.ReactNode;
}) {
  const gamesQuery = useQuery({
    queryKey: ["games", "day", date],
    queryFn: () => api.listGames({ game_date: date, limit: DAY_LIMIT }),
    // Hold the last day on screen while the next loads, so the notables below
    // do not jump up and back.
    placeholderData: keepPreviousData,
  });
  const games = gamesQuery.data?.data ?? [];
  const title = formatDayTitle(date, latest);

  return (
    <section aria-label="Results" className="space-y-2">
      <DayHeader
        title={date === latest ? `Latest · ${title}` : title}
        summary={games.length > 0 && !gamesQuery.isPlaceholderData ? daySummary(games) : null}
      >
        {picker}
      </DayHeader>
      {gamesQuery.isPending ? (
        <LoadingState label="Loading results…" />
      ) : gamesQuery.isError ? (
        <ErrorState message={queryErrorMessage(gamesQuery.error)} />
      ) : games.length === 0 ? (
        <EmptyState message="No games were played on this date." />
      ) : (
        <ul
          className={cn(gamesQuery.isPlaceholderData && "opacity-60")}
          aria-busy={gamesQuery.isFetching}
        >
          {games.map((game) => (
            <ResultRow key={game.game_id} game={game} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ResultRow({ game }: { game: LeagueGame }) {
  const { winner, loser } = resultSides(game);
  const label = `${winner.abbreviation} ${winner.score ?? ""}, ${loser.abbreviation} ${loser.score ?? ""}`;
  return (
    <li className="border-b border-rule" data-testid="result-row">
      {/* On phones the highlight wraps under the score and the arrow stays at the end of the first line. */}
      <Link
        href={`/games/${game.game_id}`}
        aria-label={label}
        // pr-3 matches .data-table's cell padding so this arrow lines up with the notables' arrows.
        className="group flex flex-wrap items-center gap-x-6 gap-y-1 py-3 pr-3 hover:bg-tint"
      >
        <span className="flex items-center gap-2">
          <TeamLogo teamId={winner.teamId} abbreviation={winner.abbreviation} />
          <span className="w-10 font-semibold">{winner.abbreviation}</span>
          <span className="tabular w-24 text-center text-lg">
            <span className="font-semibold">{winner.score}</span>
            <span className="px-1 text-ink-3">–</span>
            <span className="text-ink-2">{loser.score}</span>
          </span>
          <TeamLogo teamId={loser.teamId} abbreviation={loser.abbreviation} />
          <span className="w-10 text-ink-2">{loser.abbreviation}</span>
        </span>
        {/* Holds its width when empty so every highlight starts in the same column. */}
        <span className="max-sm:empty:hidden sm:w-44 sm:shrink-0">
          <ResultTags game={game} />
        </span>
        <span className="order-last basis-full truncate text-sm text-ink-2 sm:order-none sm:flex-1 sm:basis-auto">
          {game.lead_highlight}
        </span>
        <span aria-hidden="true" className="ml-auto text-ink-3 group-hover:text-primary">
          →
        </span>
      </Link>
    </li>
  );
}
