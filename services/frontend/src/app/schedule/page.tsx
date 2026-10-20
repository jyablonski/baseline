"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { PickCell } from "@/components/account/pick-cell";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TEAM_LOGO_SIZE, TeamAbbrLink } from "@/components/team-logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePicks } from "@/hooks/use-picks";
import { useProfile } from "@/hooks/use-profile";
import { useSeason } from "@/hooks/use-season";
import { useAccount, useFeatures } from "@/lib/account";
import { api, queryErrorMessage } from "@/lib/api";
import { formatMoneyline, formatProbability, formatScheduleDate, formatSpread } from "@/lib/format";
import { teamHref, withSeason } from "@/lib/nav";
import { formatGameTime, gamePhase, liveWindowStartDate } from "@/lib/timezones";
import type { ScheduledGame, UserPick } from "@/lib/types";
import { cn } from "@/lib/utils";

// One request covers the day on screen and reaches the next one: a full slate
// is 15 games, so the first row dated later is always inside this window.
const FETCH_LIMIT = 50;

// Abbreviations are not all one width in a proportional face ("PHI" against
// "OKC"), so the away side gets a fixed slot and the "@" and home team start
// at the same place on every row. Logo, TeamAbbrLink's gap-1.5, then room
// for the widest one.
const AWAY_TEAM_SLOT = { width: `calc(${TEAM_LOGO_SIZE}px + 0.375rem + 4.25ch)` };

export default function SchedulePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading schedule…" />}>
      <ScheduleBody />
    </Suspense>
  );
}

function ScheduleBody() {
  const { season, isLoading: seasonIsLoading } = useSeason();
  const now = useMinuteClock();
  // The days paged through so far, oldest first; empty means the first day with
  // a game from today onward (or one still live from last night). Prev pops back through the same days, so off days
  // are skipped in both directions.
  const [days, setDays] = useState<string[]>([]);
  const day = days.at(-1);
  // The API's own default is the server's UTC date, which drops an evening's
  // games from 8 PM Eastern, while they are still live.
  const firstDay = liveWindowStartDate(now);

  const scheduleQuery = useQuery({
    queryKey: ["schedule", season, day ?? firstDay],
    queryFn: () =>
      api.listSchedule({
        season: season || undefined,
        status: "Scheduled",
        from_date: day ?? firstDay,
        limit: FETCH_LIMIT,
      }),
    enabled: !seasonIsLoading,
  });

  const picks = usePicks();
  const { timezone } = useProfile();
  const { account, isLoading: accountIsLoading } = useAccount();
  const features = useFeatures();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  // A visitor with no session still gets the pick buttons, so the feature is
  // visible; choosing a side explains picks and offers sign-in back to this page.
  const signedOut = features.picks && !accountIsLoading && !account;
  const signInHref = `/signin?callbackUrl=${encodeURIComponent(search ? `${pathname}?${search}` : pathname)}`;
  // A sheet that will not load is reported too: without it the pick column
  // simply is not there, which reads as "picks are broken" with no reason given.
  const pickError = picks.save.error ?? picks.remove.error ?? picks.error;

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
            {season ? `${season} schedule` : "Upcoming schedule"} from today onward. Finished games
            are under{" "}
            <Link href="/games" className="underline underline-offset-2">
              Games
            </Link>
            .
          </p>
          {features.picks && (signedOut || picks.sheet) ? (
            <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-ink-2" data-testid="pick-intro">
              {picks.sheet ? (
                <Link href="/picks" className="underline underline-offset-2">
                  Your picks
                </Link>
              ) : null}
              <Popover>
                <PopoverTrigger className="underline underline-offset-2 hover:text-foreground">
                  How picks work
                </PopoverTrigger>
                <PopoverContent title="How picks work">
                  <HowPicksWork signInHref={signedOut ? signInHref : undefined} />
                </PopoverContent>
              </Popover>
            </p>
          ) : null}
          {pickError ? (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {queryErrorMessage(pickError)}
            </p>
          ) : null}
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
                <th>Date / time</th>
                <th>Matchup</th>
                <ColumnHelp label="TV" title="TV">
                  <p>National TV and streaming broadcasts only. Local broadcasts are not listed.</p>
                </ColumnHelp>
                <ColumnHelp label="Win %" title="Win %">
                  <p>
                    Baseline&apos;s pregame model estimate of each team&apos;s chance to win, shown
                    away / home.
                  </p>
                  <Link
                    href="/predictions"
                    className="mt-2 inline-block text-primary underline-offset-2 hover:underline"
                  >
                    How accurate is the model? →
                  </Link>
                </ColumnHelp>
                <ColumnHelp label="Moneyline" title="Moneyline">
                  <p>
                    Consensus price to win, shown away / home. A minus is the favorite: −150 means
                    staking $150 wins $100. A plus is the underdog: +130 means staking $100 wins
                    $130.
                  </p>
                  <p className="mt-2">
                    Underneath is the consensus point spread for the home team: −3.5 means the home
                    team is favored by 3.5 points.
                  </p>
                </ColumnHelp>
                <th>Status</th>
                <th>Arena</th>
                {picks.sheet || signedOut ? (
                  <ColumnHelp label="Your pick" title="How picks work" align="end">
                    <HowPicksWork signInHref={signedOut ? signInHref : undefined} />
                  </ColumnHelp>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((game) => (
                <ScheduleGame
                  key={game.game_id}
                  game={game}
                  season={season}
                  picks={picks}
                  timezone={timezone}
                  now={now}
                  signInHref={signedOut ? signInHref : undefined}
                />
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

/** The current time, moved on once a minute so rows go live and lock without a reload. */
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const PICK_STEPS = [
  ["Pick a winner", "Tap the team you think wins, any time before tip-off."],
  ["Add a stake, if you want", "Pretend dollars, paid at the moneyline. Nothing is charged."],
  ["Track your net", "Picks settle after the final. Your record and net are under Your picks."],
];

/** The three steps of making a pick; with `signInHref`, ends in a way to start. */
function HowPicksWork({ signInHref }: { signInHref?: string }) {
  return (
    <>
      <ol className="space-y-2.5">
        {PICK_STEPS.map(([title, body], index) => (
          <li key={title} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-primary text-xs text-primary tabular"
            >
              {index + 1}
            </span>
            <span>
              <span className="block font-semibold">{title}</span>
              <span className="block text-ink-2">{body}</span>
            </span>
          </li>
        ))}
      </ol>
      {signInHref ? (
        <Link href={signInHref} className="btn-fill mt-3">
          Sign in to start
        </Link>
      ) : null}
    </>
  );
}

/** A column heading that explains itself in a popover when pressed. */
function ColumnHelp({
  label,
  title,
  align,
  children,
}: {
  label: string;
  title: string;
  align?: "start" | "end";
  children: React.ReactNode;
}) {
  return (
    <th>
      <Popover>
        <PopoverTrigger
          // Inherits the heading's type; only the dotted rule marks it as pressable.
          className="[font:inherit] tracking-[inherit] text-inherit uppercase underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          {label}
        </PopoverTrigger>
        <PopoverContent title={title} align={align}>
          <div className="text-ink-2">{children}</div>
        </PopoverContent>
      </Popover>
    </th>
  );
}

function ScheduleGame({
  game,
  season,
  picks,
  timezone,
  now,
  signInHref,
}: {
  game: ScheduledGame;
  season: string;
  picks: ReturnType<typeof usePicks>;
  timezone: string | null;
  now: Date;
  /** Set for a visitor with no session: a pick button explains picks instead of saving. */
  signInHref?: string;
}) {
  // The API refuses a pick from tip-off on, so the cell locks on the same clock.
  const phase = gamePhase(game.game_date, game.start_time_et, now);
  const locked = phase !== "upcoming";
  const row = { game, season, timezone, phase };
  if (signInHref) {
    return (
      <ScheduleRow {...row}>
        <td>
          {locked ? (
            <PickCell
              game={game}
              pick={undefined}
              busy={false}
              locked
              onSave={() => {}}
              onRemove={() => {}}
            />
          ) : (
            <SignedOutPick game={game} signInHref={signInHref} />
          )}
        </td>
      </ScheduleRow>
    );
  }
  if (!picks.sheet) return <ScheduleRow {...row} />;
  const pick: UserPick | undefined = picks.sheet.picks.find(
    (item) => item.game_id === game.game_id
  );
  return (
    <ScheduleRow {...row}>
      <td>
        <PickCell
          game={game}
          pick={pick}
          busy={picks.save.isPending || picks.remove.isPending}
          locked={locked}
          onSave={picks.save.mutate}
          onRemove={picks.remove.mutate}
        />
      </td>
    </ScheduleRow>
  );
}

/** The same two buttons, opening the explanation beside the game that was pressed. */
function SignedOutPick({ game, signInHref }: { game: ScheduledGame; signInHref: string }) {
  const [open, setOpen] = useState(false);
  const cell = useRef<HTMLDivElement>(null);
  return (
    <div ref={cell}>
      <PickCell
        game={game}
        pick={undefined}
        busy={false}
        onSave={() => setOpen(true)}
        onRemove={() => setOpen(true)}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverContent title="How picks work" anchor={cell} align="end">
          <HowPicksWork signInHref={signInHref} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ScheduleRow({
  game,
  season,
  timezone,
  phase,
  children,
}: {
  game: ScheduledGame;
  season: string;
  timezone: string | null;
  phase: ReturnType<typeof gamePhase>;
  children?: React.ReactNode;
}) {
  // Pregame numbers stay readable once the game is on, but step back.
  const pregame = phase === "upcoming" ? undefined : "text-ink-3";
  const tip = formatGameTime(game.game_date, game.start_time_et, timezone);
  const away = game.away_team_abbreviation ?? "Away";
  const home = game.home_team_abbreviation ?? "Home";
  const arena = game.arena || game.arena_city || "—";
  return (
    <tr>
      <td className="tabular whitespace-nowrap">
        <Link href={`/games/${game.game_id}`} className="group block" title="Game preview">
          <span className="block group-hover:text-primary group-hover:underline">{tip.date}</span>
          <span className="block text-xs text-muted-foreground">
            {tip.zone ? `${tip.time} ${tip.zone}` : tip.time}
          </span>
        </Link>
      </td>
      <td>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {/* Semibold here too: the slot's ch is measured in the weight the abbreviation is set in. */}
          <span className="inline-flex font-semibold" style={AWAY_TEAM_SLOT}>
            {game.away_team_id ? (
              <TeamAbbrLink
                teamId={game.away_team_id}
                abbreviation={away}
                href={withSeason(teamHref(game.away_team_name ?? away), season)}
              />
            ) : (
              away
            )}
          </span>
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
        <NotableOut abbreviation={away} names={game.away_notable_out} />
        <NotableOut abbreviation={home} names={game.home_notable_out} />
      </td>
      <td className="whitespace-nowrap" data-testid="national-tv">
        {game.national_tv || "—"}
      </td>
      <td className={cn("tabular whitespace-nowrap", pregame)} data-testid="win-probability">
        {pairOrDash(
          formatProbability(game.away_win_probability),
          formatProbability(game.home_win_probability)
        )}
      </td>
      <td className={cn("tabular whitespace-nowrap", pregame)}>
        <span className="block" data-testid="moneyline">
          {pairOrDash(formatMoneyline(game.away_moneyline), formatMoneyline(game.home_moneyline))}
        </span>
        {game.home_spread == null ? null : (
          <span className={cn("block text-xs", pregame ?? "text-ink-2")} data-testid="spread">
            {home} {formatSpread(game.home_spread)}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap" data-testid="game-status">
        <GameStatus status={game.status} phase={phase} />
      </td>
      <td>{arena}</td>
      {children}
    </tr>
  );
}

/**
 * "Live" for three hours from the scheduled tip, by the clock alone: there is no
 * live feed, so no score or game clock. Past that the game waits on its final.
 */
function GameStatus({ status, phase }: { status: string; phase: ReturnType<typeof gamePhase> }) {
  if (phase === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-destructive">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
        Live
      </span>
    );
  }
  if (phase === "started") return <span className="text-ink-2">Awaiting final</span>;
  return <>{status || "Scheduled"}</>;
}

// One missing side means the pair is not trustworthy; render a single dash.
function pairOrDash(away: string, home: string) {
  if (away === "—" || home === "—") return "—";
  return `${away} / ${home}`;
}

/** A notable player ruled out, under the matchup. Nothing for doubts or bench players. */
function NotableOut({ abbreviation, names }: { abbreviation: string; names?: string[] }) {
  if (!names || names.length === 0) return null;
  return (
    <span className="mt-1 block text-xs text-destructive" data-testid="notable-out">
      {abbreviation}: {names.join(", ")} out
    </span>
  );
}
