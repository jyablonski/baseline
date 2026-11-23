"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { DayCalendar, DayHeader } from "@/components/day-picker";
import { B2BLegend } from "@/components/games/b2b-badge";
import { ResultRow } from "@/components/games/result-row";
import { ScheduleTable, useMinuteClock } from "@/components/games/schedule-table";
import { SeasonNotables } from "@/components/games/season-notables";
import { WeekStrip } from "@/components/games/week-strip";
import { ErrorState, LoadingState } from "@/components/query-state";
import { Switch } from "@/components/ui/switch";
import { hrefWithParams, useDayParam } from "@/hooks/use-day-param";
import { useGameDates } from "@/hooks/use-game-dates";
import { useHydrated } from "@/hooks/use-hydrated";
import { usePicks } from "@/hooks/use-picks";
import { useProfile } from "@/hooks/use-profile";
import { useSeason } from "@/hooks/use-season";
import { useAccount, useFeatures } from "@/lib/account";
import { api, queryErrorMessage } from "@/lib/api";
import { isCalendarDate, shiftDay, stripWeek } from "@/lib/calendar";
import { isoDateET } from "@/lib/format";
import { involvesFollowed } from "@/lib/follows";
import { formatDayShort, formatDayTitle } from "@/lib/results";
import { formatGameTime, gamePhase, liveWindowStartDate } from "@/lib/timezones";
import type { GameDay, ScheduledGame } from "@/lib/types";
import { cn } from "@/lib/utils";

// A full slate is 15 games; this covers any single day.
const DAY_LIMIT = 20;
// The schedule request runs from the day on screen; 50 always holds the whole day.
const SCHEDULE_LIMIT = 50;

export default function GamesPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading games…" />}>
      <GamesBody />
    </Suspense>
  );
}

function GamesBody() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const notables = searchParams.get("view") === "notables";
  const { account } = useAccount();
  const features = useFeatures();
  // "Today" is read from the visitor's clock, which the server cannot know:
  // rendered there, the week strip would disagree with the browser's.
  const hydrated = useHydrated();

  // Each view keeps only its own params, so a link to one never carries the other's.
  const scheduleHref = (() => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["view", "tab", "team"]) params.delete(key);
    return hrefWithParams(pathname, params);
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-2 border-b border-rule-strong">
        <h1 className="type-page pb-2">Games</h1>
        <nav aria-label="Games views" className="-mb-px flex gap-5 self-stretch">
          <ViewTab href={scheduleHref} active={!notables}>
            Schedule &amp; results
          </ViewTab>
          <ViewTab href={`${pathname}?view=notables`} active={notables}>
            Season notables
          </ViewTab>
        </nav>
        {features.picks && account ? (
          <Link href="/picks" className="ml-auto pb-3 text-sm whitespace-nowrap text-primary">
            Your picks →
          </Link>
        ) : null}
      </div>
      {notables ? (
        <NotablesView />
      ) : hydrated ? (
        <ScheduleView />
      ) : (
        <LoadingState label="Loading games…" />
      )}
    </div>
  );
}

/** The header's underline tab, at page scale. */
function ViewTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn("ct-tab whitespace-nowrap", active && "ct-tab-active")}
    >
      {children}
    </Link>
  );
}

function NotablesView() {
  // Notables follow the newest season with a finished game, not the schedule's:
  // before opening night that is still last season.
  const datesQuery = useGameDates();
  if (datesQuery.isPending) return <LoadingState label="Loading notable games…" />;
  if (datesQuery.isError) return <ErrorState message={queryErrorMessage(datesQuery.error)} />;
  return <SeasonNotables season={datesQuery.data.data[0]?.season ?? ""} />;
}

function ScheduleView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const now = useMinuteClock();
  // "Today" is the league's (Eastern) date, not the visitor's or UTC.
  const today = isoDateET(now);
  const requested = searchParams.get("date");
  const date = requested && isCalendarDate(requested) ? requested : today;
  const showDay = useDayParam(today);
  const week = stripWeek(date, today);

  const daysQuery = useQuery({
    queryKey: ["games", "days", week[0], week[6]],
    queryFn: () => api.listGameDays({ from: week[0], to: week[6] }),
    placeholderData: keepPreviousData,
  });
  const counts = useMemo(
    () =>
      daysQuery.data && !daysQuery.isPlaceholderData
        ? new Map<string, GameDay>(daysQuery.data.data.map((day) => [day.date.slice(0, 10), day]))
        : undefined,
    [daysQuery.data, daysQuery.isPlaceholderData]
  );

  // The calendar's dots and the empty day's "next date" link: every finished
  // day plus every day still to play.
  const finishedDates = useGameDates();
  const upcomingDates = useQuery({
    queryKey: ["schedule", "dates", "", today],
    queryFn: () => api.listScheduleDates({ from_date: today }),
  });
  const gameDays = useMemo(
    () =>
      [
        ...new Set(
          [...(finishedDates.data?.data ?? []), ...(upcomingDates.data?.data ?? [])].map((item) =>
            item.game_date.slice(0, 10)
          )
        ),
      ].sort(),
    [finishedDates.data, upcomingDates.data]
  );

  const { season, isLoading: seasonIsLoading } = useSeason();
  // Finals exist up to today; games still to finish from the Eastern date three
  // hours ago, so a late tip stays on screen past midnight.
  const finalsEnabled = date <= today;
  const openEnabled = date >= liveWindowStartDate(now);
  const finalsQuery = useQuery({
    queryKey: ["games", "day", date],
    queryFn: () => api.listGames({ game_date: date, limit: DAY_LIMIT }),
    enabled: finalsEnabled,
    // Hold the last day on screen while the next loads, so the list does not
    // collapse to a spinner and back.
    placeholderData: keepPreviousData,
  });
  const openQuery = useQuery({
    queryKey: ["schedule", season, date],
    queryFn: () =>
      api.listSchedule({
        season: season || undefined,
        status: "Scheduled",
        from_date: date,
        limit: SCHEDULE_LIMIT,
      }),
    // Held until the season is known: it is part of the key, so asking before
    // would fetch the day twice.
    enabled: openEnabled && !seasonIsLoading,
    placeholderData: keepPreviousData,
  });

  const picks = usePicks();
  const { timezone, followedTeamIds } = useProfile();
  const { account, isLoading: accountIsLoading } = useAccount();
  const features = useFeatures();
  const search = searchParams.toString();
  // A visitor with no session still gets the pick buttons, so the feature is
  // visible; choosing a side explains picks and offers sign-in back to this page.
  const signedOut = features.picks && !accountIsLoading && !account;
  const signInHref = `/signin?callbackUrl=${encodeURIComponent(search ? `${pathname}?${search}` : pathname)}`;
  const pickError = picks.save.error ?? picks.remove.error ?? picks.error;
  const picksByGame = useMemo(
    () => new Map((picks.sheet?.picks ?? []).map((pick) => [pick.game_id, pick])),
    [picks.sheet]
  );

  // A disabled query can still hold the last day's rows as placeholder data, so
  // only an enabled one counts. While the next day loads, the last day's rows
  // stay (dimmed) rather than being filtered against the new day into nothing.
  const finalsData = finalsEnabled ? (finalsQuery.data?.data ?? []) : [];
  const openFetched = openEnabled ? (openQuery.data?.data ?? []) : [];
  const busy =
    (finalsEnabled && finalsQuery.isPlaceholderData) ||
    (openEnabled && openQuery.isPlaceholderData);
  const openDay = openEnabled && openQuery.isPlaceholderData ? openFetched[0]?.game_date : date;
  const openData = sortOpen(
    openFetched.filter((game) => game.game_date.slice(0, 10) === openDay?.slice(0, 10)),
    now
  );

  // ?mine=1 keeps only followed teams' games. It is ignored with no follows, so
  // a shared link never shows an empty list to someone else.
  const following = followedTeamIds.size > 0;
  const mineOnly = following && searchParams.get("mine") === "1";
  const finals = mineOnly
    ? finalsData.filter((game) => involvesFollowed(game, followedTeamIds))
    : finalsData;
  const open = mineOnly
    ? openData.filter((game) => involvesFollowed(game, followedTeamIds))
    : openData;
  const setMineOnly = (on: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (on) params.set("mine", "1");
    else params.delete("mine");
    router.replace(hrefWithParams(pathname, params), { scroll: false });
  };

  const isPending =
    (finalsEnabled && finalsQuery.isPending) || (openEnabled && openQuery.isPending);
  const error = (finalsEnabled && finalsQuery.error) || (openEnabled && openQuery.error) || null;
  const upcoming = date >= today;
  const total = finals.length + open.length;
  const zone =
    open
      .map((game) => formatGameTime(game.game_date, game.start_time_et, timezone).zone)
      .find(Boolean) || "ET";
  const showPicks = Boolean(picks.sheet);

  return (
    <section aria-label="Schedule and results" className="space-y-5">
      <WeekStrip
        days={week}
        selected={date}
        today={today}
        counts={counts}
        onPick={showDay}
        onShiftWeek={(weeks) => showDay(shiftDay(date, weeks * 7))}
        calendar={
          <DayCalendar
            current={date}
            home={today}
            homeLabel="Today"
            gameDays={gameDays}
            onPick={showDay}
            className="shrink-0 font-semibold"
          />
        }
      />
      {pickError ? (
        <p className="text-sm text-destructive" role="alert">
          {queryErrorMessage(pickError)}
        </p>
      ) : null}
      <div className="space-y-2">
        <DayHeader
          title={dayTitle(date, today)}
          summary={
            total > 0 && !busy ? (
              <>
                <span>
                  {`${total} ${total === 1 ? "game" : "games"} · ${open.length > 0 ? zone : "final"}`}
                </span>
                {upcoming &&
                open.some((game) => game.home_is_back_to_back || game.away_is_back_to_back) ? (
                  <B2BLegend />
                ) : null}
              </>
            ) : null
          }
        >
          {following ? (
            <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
              My teams
              <Switch
                checked={mineOnly}
                label="Only my teams"
                onChange={() => setMineOnly(!mineOnly)}
              />
            </label>
          ) : null}
        </DayHeader>
        {isPending ? (
          <LoadingState label="Loading games…" />
        ) : error ? (
          <ErrorState message={queryErrorMessage(error)} />
        ) : total === 0 ? (
          <EmptyDay
            date={date}
            gameDays={gameDays}
            mineOnly={mineOnly && finalsData.length + openData.length > 0}
            hrefFor={showDay.hrefFor}
          />
        ) : (
          <div className="border-t border-rule-strong">
            {/* Finals first, then live, then upcoming: each in its own row style. */}
            {finals.length > 0 ? (
              <ul className={cn(busy && "opacity-60")} aria-busy={busy}>
                {finals.map((game) => (
                  <ResultRow
                    key={game.game_id}
                    game={game}
                    pick={picksByGame.get(game.game_id)}
                    showPicks={showPicks}
                    followed={!mineOnly && involvesFollowed(game, followedTeamIds)}
                  />
                ))}
              </ul>
            ) : null}
            {open.length > 0 ? (
              <ScheduleTable
                rows={open}
                season={season}
                picks={picks}
                timezone={timezone}
                now={now}
                followed={mineOnly ? undefined : followedTeamIds}
                signInHref={signedOut ? signInHref : undefined}
                busy={busy}
              />
            ) : null}
          </div>
        )}
        {total > 0 ? (
          <p className="pt-2 text-[13px] text-ink-3">
            {open.length > 0
              ? `${features.picks ? "Picks lock at tip-off. " : ""}Win % from Baseline's model; injuries in red include a key player.`
              : `Tags and notes from play-by-play.${showPicks ? " Your settled picks show on the right." : ""} Click a game for the box score.`}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Live and awaiting-final games before ones still to tip; otherwise in schedule order. */
function sortOpen(games: ScheduledGame[], now: Date) {
  const started = (game: ScheduledGame) =>
    gamePhase(game.game_date, game.start_time_et, now) === "upcoming" ? 1 : 0;
  return [...games].sort((left, right) => started(left) - started(right));
}

/** "Today · Sunday, November 22", "Last night · …", "Tomorrow · …", or just the date. */
function dayTitle(date: string, today: string) {
  const title = formatDayTitle(date, today);
  if (date === today) return `Today · ${title}`;
  if (date === shiftDay(today, -1)) return `Last night · ${title}`;
  if (date === shiftDay(today, 1)) return `Tomorrow · ${title}`;
  return title;
}

/** One muted line, and a way to the nearest date that has games. */
function EmptyDay({
  date,
  gameDays,
  mineOnly,
  hrefFor,
}: {
  date: string;
  gameDays: string[];
  /** The day has games, just none of the visitor's teams. */
  mineOnly: boolean;
  hrefFor: (date: string) => string;
}) {
  const next = gameDays.find((day) => day > date);
  const previous = gameDays.filter((day) => day < date).at(-1);
  const target = next ?? previous;
  return (
    <p className="border-t border-rule-strong py-4 text-sm text-ink-2" data-testid="empty-day">
      {mineOnly ? "None of your teams play on this date." : "No games on this date."}
      {target && !mineOnly ? (
        <>
          {" "}
          <Link href={hrefFor(target)} scroll={false} className="text-primary hover:underline">
            {next ? "Next games" : "Latest games"}: {formatDayShort(target)} →
          </Link>
        </>
      ) : null}
    </p>
  );
}
