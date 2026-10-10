"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { PickCell } from "@/components/account/pick-cell";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamAbbrLink } from "@/components/team-logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePicks } from "@/hooks/use-picks";
import { useProfile } from "@/hooks/use-profile";
import { useSeason } from "@/hooks/use-season";
import { useAccount, useFeatures } from "@/lib/account";
import { api, queryErrorMessage } from "@/lib/api";
import { formatMoneyline, formatProbability, formatScheduleDate, formatSpread } from "@/lib/format";
import { teamHref, withSeason } from "@/lib/nav";
import { formatGameTime } from "@/lib/timezones";
import type { ScheduledGame, UserPick } from "@/lib/types";

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
            {season ? `${season} schedule` : "Upcoming schedule"} from today onward.
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
                </ColumnHelp>
                <ColumnHelp label="Spread" title="Spread">
                  <p>
                    Consensus point spread for the home team. −3.5 means the home team is favored by
                    3.5 points.
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
  signInHref,
}: {
  game: ScheduledGame;
  season: string;
  picks: ReturnType<typeof usePicks>;
  timezone: string | null;
  /** Set for a visitor with no session: a pick button explains picks instead of saving. */
  signInHref?: string;
}) {
  if (signInHref) {
    return (
      <ScheduleRow game={game} season={season} timezone={timezone}>
        <td>
          <SignedOutPick game={game} signInHref={signInHref} />
        </td>
      </ScheduleRow>
    );
  }
  if (!picks.sheet) return <ScheduleRow game={game} season={season} timezone={timezone} />;
  const pick: UserPick | undefined = picks.sheet.picks.find(
    (item) => item.game_id === game.game_id
  );
  return (
    <ScheduleRow game={game} season={season} timezone={timezone}>
      <td>
        <PickCell
          game={game}
          pick={pick}
          busy={picks.save.isPending || picks.remove.isPending}
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
  children,
}: {
  game: ScheduledGame;
  season: string;
  timezone: string | null;
  children?: React.ReactNode;
}) {
  const tip = formatGameTime(game.game_date, game.start_time_et, timezone);
  const away = game.away_team_abbreviation ?? "Away";
  const home = game.home_team_abbreviation ?? "Home";
  const arena = game.arena || game.arena_city || "—";
  return (
    <tr>
      <td className="tabular whitespace-nowrap">
        <span className="block">{tip.date}</span>
        <span className="block text-xs text-muted-foreground">
          {tip.zone ? `${tip.time} ${tip.zone}` : tip.time}
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
      {children}
    </tr>
  );
}

// One missing side means the pair is not trustworthy; render a single dash.
function pairOrDash(away: string, home: string) {
  if (away === "—" || home === "—") return "—";
  return `${away} / ${home}`;
}
