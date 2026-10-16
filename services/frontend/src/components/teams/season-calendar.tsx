"use client";

import { useState } from "react";
import Link from "next/link";

import { TeamLogo } from "@/components/team-logo";
import {
  defaultMonth,
  formatMonth,
  monthGrid,
  seasonMonths,
  shiftMonth,
  type CalendarCell,
} from "@/lib/calendar";
import { formatProbability, formatScheduleDate, isoDateET } from "@/lib/format";
import { formatGameTime } from "@/lib/timezones";
import type { TeamSeasonGame } from "@/lib/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CELL_LOGO_SIZE = 20;

/** A team's season as a month grid, every game linking to its page. */
export function SeasonCalendar({
  games,
  timezone,
}: {
  games: TeamSeasonGame[];
  timezone: string | null;
}) {
  const today = isoDateET();
  const dates = games.map((game) => game.game_date.slice(0, 10));
  const months = seasonMonths(dates);
  const [month, setMonth] = useState(() => defaultMonth(dates, today));
  const byDate = new Map<string, TeamSeasonGame[]>();
  for (const game of games) {
    const date = game.game_date.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), game]);
  }
  const index = months.indexOf(month);

  return (
    <div data-testid="season-calendar">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn-ghost"
          disabled={index <= 0}
          onClick={() => setMonth((current) => shiftMonth(current, -1))}
        >
          ← Prev
        </button>
        <h3 className="type-module" aria-live="polite">
          {formatMonth(month)}
        </h3>
        <button
          type="button"
          className="btn-ghost"
          disabled={index === -1 || index >= months.length - 1}
          onClick={() => setMonth((current) => shiftMonth(current, 1))}
        >
          Next →
        </button>
      </div>
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{formatMonth(month)} games</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((day) => (
              <th key={day} scope="col" className="type-eyebrow pb-1 text-left font-normal">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(month).map((week) => (
            <tr key={week[0].date}>
              {week.map((cell) => (
                <DayCell
                  key={cell.date}
                  cell={cell}
                  today={cell.date === today}
                  // A neighbouring month's days are filler: their games belong to that month's page.
                  games={cell.inMonth ? (byDate.get(cell.date) ?? []) : []}
                  timezone={timezone}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="type-caption mt-2">
        Win % is Baseline&apos;s pregame model estimate for this team. B2B marks the second night of
        a back-to-back.
      </p>
    </div>
  );
}

function DayCell({
  cell,
  today,
  games,
  timezone,
}: {
  cell: CalendarCell;
  today: boolean;
  games: TeamSeasonGame[];
  timezone: string | null;
}) {
  return (
    <td
      className={cn(
        "h-20 border border-rule p-1 align-top sm:h-24",
        !cell.inMonth && "bg-muted/40 text-ink-3"
      )}
    >
      <span
        className={cn(
          "block text-xs tabular",
          today && "inline-block bg-primary px-1 font-semibold text-primary-foreground"
        )}
      >
        {Number(cell.date.slice(8, 10))}
      </span>
      {/* One team never plays twice on a date, but stack rather than assume it. */}
      {games.map((game) => (
        <GameEntry key={game.game_id} game={game} timezone={timezone} />
      ))}
    </td>
  );
}

function GameEntry({ game, timezone }: { game: TeamSeasonGame; timezone: string | null }) {
  const opponent = game.opponent_abbreviation ?? "Opponent";
  const side = game.is_home ? "vs" : "@";
  const tip = formatGameTime(game.game_date, game.start_time_et, timezone);
  const score =
    game.team_score != null && game.opponent_score != null
      ? `${game.team_score}–${game.opponent_score}`
      : null;
  const outcome = game.result
    ? `${game.result === "W" ? "won" : "lost"} ${score}`
    : game.status === "Final"
      ? "final"
      : game.status !== "Scheduled"
        ? game.status.toLowerCase()
        : tip.zone
          ? `${tip.time} ${tip.zone}`
          : tip.time;
  const label = `${formatScheduleDate(game.game_date)}, ${game.is_home ? "vs" : "at"} ${opponent}, ${outcome}`;

  return (
    <Link
      href={`/games/${game.game_id}`}
      aria-label={label}
      data-testid="calendar-game"
      className={cn(
        "mt-0.5 block border-l-2 px-1 py-0.5 hover:bg-tint",
        game.result === "W" && "border-primary bg-accent-soft",
        game.result === "L" && "border-destructive",
        !game.result && "border-rule"
      )}
    >
      <span className="flex items-center gap-1 font-semibold">
        <span className="text-xs font-normal text-ink-3">{side}</span>
        <TeamLogo
          teamId={game.opponent_team_id}
          abbreviation={opponent}
          size={CELL_LOGO_SIZE}
          className="hidden sm:inline-flex"
        />
        <span>{opponent}</span>
      </span>
      {game.result ? (
        <span
          className={cn(
            "block text-xs tabular",
            game.result === "W" ? "text-primary" : "text-destructive"
          )}
        >
          {game.result} <span className="hidden sm:inline">{score}</span>
        </span>
      ) : (
        <span className="hidden text-xs text-ink-2 tabular sm:block">
          {game.status === "Scheduled" ? tip.time : game.status}
          {game.win_probability != null ? ` · ${formatProbability(game.win_probability)}` : ""}
        </span>
      )}
      {game.is_back_to_back ? (
        <span className="type-eyebrow hidden tracking-normal sm:block" title="Back-to-back">
          B2B
        </span>
      ) : null}
    </Link>
  );
}
