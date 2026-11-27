"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { PickCell } from "@/components/account/pick-cell";
import { ColumnHelp } from "@/components/column-help";
import { B2BBadge } from "@/components/games/b2b-badge";
import { InjuryField } from "@/components/injuries/injury-field";
import { TeamAbbrLink } from "@/components/team-logo";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { usePicks } from "@/hooks/use-picks";
import { involvesFollowed } from "@/lib/follows";
import { formatMoneyline, formatProbability, formatSpread } from "@/lib/format";
import { teamHref, withSeason } from "@/lib/nav";
import { formatGameTime, gamePhase, otherLocalDate } from "@/lib/timezones";
import type { ScheduledGame, UserPick } from "@/lib/types";
import { cn } from "@/lib/utils";

// Shrinkable tracks rather than fixed widths, so the table fits a 900px window.
// Cells that must stay on one line (time, teams, odds) hold their content's
// width; TV and the pick cell may wrap, and spare room is shared by fr.
const TRACKS = {
  time: "max-content",
  away: "max-content",
  home: "minmax(max-content, 1.5fr)",
  tv: "minmax(min-content, 1fr)",
  winProbability: "minmax(max-content, 1fr)",
  odds: "minmax(max-content, 1fr)",
  injuries: "minmax(max-content, 1fr)",
  pick: "minmax(min-content, 1.5fr)",
};

/**
 * A day of games still to finish: time, matchup, TV, win %, odds, injuries
 * and the pick cell. A grid of subgrid rows (`.schedule-grid`), which stacks
 * each game into a card on phones.
 */
export function ScheduleTable({
  rows,
  season,
  picks,
  timezone,
  now,
  signInHref,
  busy,
  followed,
}: {
  rows: ScheduledGame[];
  season: string;
  picks: ReturnType<typeof usePicks>;
  timezone: string | null;
  now: Date;
  /** Followed teams, whose rows are tinted. Unset when the table shows only them. */
  followed?: ReadonlySet<string>;
  /** Set for a visitor with no session: the pick column explains picks instead. */
  signInHref?: string;
  /** The previous day still on screen while the picked one loads. */
  busy: boolean;
}) {
  const showPicks = Boolean(picks.sheet || signInHref);
  const columns = [
    TRACKS.time,
    TRACKS.away,
    TRACKS.home,
    TRACKS.tv,
    TRACKS.winProbability,
    TRACKS.odds,
    TRACKS.injuries,
    ...(showPicks ? [TRACKS.pick] : []),
  ].join(" ");
  return (
    <div className={cn(busy && "opacity-60")} aria-busy={busy}>
      {/* Roles spelled out: a table laid out as a grid can lose its implicit ones. */}
      <table
        role="table"
        className="data-table schedule-grid"
        style={{ gridTemplateColumns: columns }}
        data-testid="schedule-table"
      >
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader">Time</th>
            <th role="columnheader" colSpan={2} className="col-span-2">
              Matchup
            </th>
            <ColumnHelp label="TV" title="TV">
              <p>National TV and streaming broadcasts only. Local broadcasts are not listed.</p>
            </ColumnHelp>
            <ColumnHelp label="Win %" title="Win %">
              <p>
                Baseline&apos;s pregame model estimate of each team&apos;s chance to win, shown away
                / home.
              </p>
              <Link
                href="/predictions"
                className="mt-2 inline-block text-primary underline-offset-2 hover:underline"
              >
                How accurate is the model? →
              </Link>
            </ColumnHelp>
            <ColumnHelp label="Odds" title="Odds">
              <p>
                The consensus moneyline, the price to win, shown away / home. A minus is the
                favorite: −150 means staking $150 wins $100. A plus is the underdog: +130 means
                staking $100 wins $130.
              </p>
              <p className="mt-2">
                Underneath is the consensus point spread for the home team: −3.5 means the home team
                is favored by 3.5 points.
              </p>
            </ColumnHelp>
            <ColumnHelp label="Injuries" title="Injuries">
              <p>
                Players on the morning injury report. Shown when a top 100 player or a team&apos;s
                top two is out or day to day.
              </p>
              <p className="mt-2">Red: one of them is out. Grey: day to day.</p>
            </ColumnHelp>
            {showPicks ? (
              <ColumnHelp label="Your pick" title="How picks work" align="end">
                <HowPicksWork signInHref={signInHref} />
              </ColumnHelp>
            ) : null}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((game) => (
            <ScheduleGame
              key={game.game_id}
              game={game}
              season={season}
              picks={picks}
              timezone={timezone}
              now={now}
              signInHref={signInHref}
              followed={followed ? involvesFollowed(game, followed) : false}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The current time, moved on once a minute so rows go live and lock without a reload. */
export function useMinuteClock() {
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

function ScheduleGame({
  game,
  season,
  picks,
  timezone,
  now,
  signInHref,
  followed,
}: {
  game: ScheduledGame;
  season: string;
  picks: ReturnType<typeof usePicks>;
  timezone: string | null;
  now: Date;
  /** Set for a visitor with no session: a pick button explains picks instead of saving. */
  signInHref?: string;
  followed: boolean;
}) {
  // The API refuses a pick from tip-off on, so the cell locks on the same clock.
  const phase = gamePhase(game.game_date, game.start_time_et, now);
  const locked = phase !== "upcoming";
  const row = { game, season, timezone, phase, followed };
  if (signInHref) {
    return (
      <ScheduleRow {...row}>
        <td role="cell" data-cell="pick">
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
      <td role="cell" data-cell="pick">
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
  followed,
  children,
}: {
  game: ScheduledGame;
  season: string;
  timezone: string | null;
  phase: ReturnType<typeof gamePhase>;
  /** A followed team plays: the row is tinted. */
  followed: boolean;
  children?: React.ReactNode;
}) {
  // Pregame numbers stay readable once the game is on, but step back.
  const pregame = phase === "upcoming" ? undefined : "text-ink-3";
  const tip = formatGameTime(game.game_date, game.start_time_et, timezone);
  const localDate = otherLocalDate(tip.date, game.game_date);
  const away = game.away_team_abbreviation ?? "Away";
  const home = game.home_team_abbreviation ?? "Home";
  return (
    <tr role="row" className={cn(followed && "bg-tint")} data-followed={followed || undefined}>
      <td role="cell" className="tabular whitespace-nowrap" data-cell="time">
        <Link href={`/games/${game.game_id}`} className="group block" title="Game preview">
          <span className="block group-hover:text-primary group-hover:underline">
            {tip.zone ? `${tip.time} ${tip.zone}` : tip.time}
          </span>
          {/* The day header already names the date; only a tip on another local day says so. */}
          {localDate ? (
            <span className="block text-xs text-muted-foreground">{localDate}</span>
          ) : null}
        </Link>
        {/* Under the time rather than in a column of its own, so a live day is no wider. */}
        {phase === "upcoming" ? null : (
          <span className="block text-xs" data-testid="game-status">
            <GameStatus phase={phase} />
          </span>
        )}
      </td>
      {/* Block-level flex in both halves: an inline-flex sits on a text line, and the away
          side's baseline comes from its logo, the home side's from "@", so they drifted apart. */}
      <td role="cell" data-cell="away">
        <span className="flex items-center gap-1 font-semibold whitespace-nowrap">
          {game.away_team_id ? (
            <TeamAbbrLink
              teamId={game.away_team_id}
              abbreviation={away}
              href={withSeason(teamHref(game.away_team_name ?? away), season)}
            />
          ) : (
            away
          )}
          <B2BBadge game={game} side="away" />
        </span>
      </td>
      <td role="cell" data-cell="home">
        <span className="flex items-center gap-1.5 whitespace-nowrap">
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
          <B2BBadge game={game} side="home" />
        </span>
      </td>
      <td role="cell" data-cell="tv" data-label="TV" data-testid="national-tv">
        {game.national_tv || "—"}
      </td>
      <td
        role="cell"
        className={cn("tabular whitespace-nowrap", pregame)}
        data-cell="win"
        data-label="Win %"
        data-testid="win-probability"
      >
        {pairOrDash(
          formatProbability(game.away_win_probability),
          formatProbability(game.home_win_probability)
        )}
      </td>
      <td
        role="cell"
        className={cn("tabular whitespace-nowrap", pregame)}
        data-cell="odds"
        data-label="Odds"
      >
        <span className="block" data-testid="moneyline">
          {pairOrDash(formatMoneyline(game.away_moneyline), formatMoneyline(game.home_moneyline))}
        </span>
        {game.home_spread == null ? null : (
          <span className={cn("block text-xs", pregame ?? "text-ink-2")} data-testid="spread">
            {home} {formatSpread(game.home_spread)}
          </span>
        )}
      </td>
      <td
        role="cell"
        className="whitespace-nowrap"
        data-cell="injuries"
        data-label="Injuries"
        data-testid="game-injuries"
      >
        {game.has_key_injury ? <InjuryField game={game} /> : <span className="text-ink-3">—</span>}
      </td>
      {children}
    </tr>
  );
}

/**
 * "Live" for three hours from the scheduled tip, by the clock alone: there is no
 * live feed, so no score or game clock. Past that the game waits on its final.
 */
function GameStatus({ phase }: { phase: ReturnType<typeof gamePhase> }) {
  if (phase === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-destructive">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
        Live
      </span>
    );
  }
  return <span className="text-ink-2">Awaiting final</span>;
}

// One missing side means the pair is not trustworthy; render a single dash.
function pairOrDash(away: string, home: string) {
  if (away === "—" || home === "—") return "—";
  return `${away} / ${home}`;
}
