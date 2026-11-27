"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { DayNumber, MonthNav, WeekdayHead } from "@/components/month-nav";
import { ErrorState, LoadingState } from "@/components/query-state";
import { useGameDates } from "@/hooks/use-game-dates";
import { queryErrorMessage } from "@/lib/api";
import {
  formatMonth,
  formatMonthLong,
  monthGrid,
  monthOf,
  seasonMonths,
  type CalendarCell,
} from "@/lib/calendar";
import { formatScheduleDate, isoDateET } from "@/lib/format";
import {
  formatSignedMoney,
  monthPickSummary,
  percentCorrect,
  pickDays,
  type PickDay,
} from "@/lib/picks";
import type { UserPick } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The pick sheet as a month grid: each day's record and net, and the game days skipped. */
export function PicksCalendar({ picks }: { picks: UserPick[] }) {
  const today = isoDateET();
  const datesQuery = useGameDates();
  const gameDates = useMemo(
    () => (datesQuery.data?.data ?? []).map((item) => item.game_date.slice(0, 10)),
    [datesQuery.data]
  );
  const days = useMemo(() => pickDays(picks, gameDates, today), [picks, gameDates, today]);
  const months = seasonMonths([...gameDates, ...days.keys()]);
  const [chosen, setChosen] = useState<string | null>(null);
  // Today's month while it is in the season, else the season's last.
  const month =
    chosen ??
    (months.includes(monthOf(today)) ? monthOf(today) : (months.at(-1) ?? monthOf(today)));

  if (datesQuery.isPending) return <LoadingState label="Loading calendar…" />;
  if (datesQuery.isError) return <ErrorState message={queryErrorMessage(datesQuery.error)} />;

  const summary = monthPickSummary(days.values(), month, today);
  return (
    <div data-testid="picks-calendar">
      <MonthNav month={month} months={months} onChange={setChosen} />
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{formatMonth(month)} picks</caption>
        <WeekdayHead />
        <tbody>
          {monthGrid(month).map((week) => (
            <tr key={week[0].date}>
              {week.map((cell) => (
                <DayCell
                  key={cell.date}
                  cell={cell}
                  today={cell.date === today}
                  // A neighbouring month's days are filler, as on the team calendar.
                  day={cell.inMonth ? days.get(cell.date) : undefined}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm text-ink-2" data-testid="calendar-summary">
        {[
          summary.wins + summary.losses > 0
            ? `${summary.wins}–${summary.losses} in ${formatMonthLong(month)}`
            : null,
          percentCorrect(summary.wins, summary.losses),
          summary.staked ? `net ${formatSignedMoney(summary.net)}` : null,
          summary.picked + summary.missed > 0
            ? `picked on ${summary.picked} of ${summary.picked + summary.missed} game days`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || "No picks this month."}
      </p>
    </div>
  );
}

type DayTone = "won" | "lost" | "even" | null;

function DayCell({ cell, today, day }: { cell: CalendarCell; today: boolean; day?: PickDay }) {
  const graded = day ? day.wins + day.losses : 0;
  const tone: DayTone =
    !day || graded === 0
      ? null
      : day.wins > day.losses
        ? "won"
        : day.wins < day.losses
          ? "lost"
          : "even";
  return (
    <td
      className={cn(
        "h-20 border border-rule p-1 align-top sm:h-24",
        !cell.inMonth && "bg-muted/40 text-ink-3",
        tone === "won" && "bg-primary/10",
        tone === "lost" && "bg-destructive/10",
        day?.missed && "bg-muted/60"
      )}
      data-testid={day ? "pick-day" : undefined}
      data-date={day ? cell.date : undefined}
    >
      <DayNumber date={cell.date} today={today} />
      {day ? <DayEntry day={day} graded={graded} tone={tone} /> : null}
    </td>
  );
}

function DayEntry({ day, graded, tone }: { day: PickDay; graded: number; tone: DayTone }) {
  const label = day.missed
    ? `${formatScheduleDate(day.date)}, no picks`
    : [
        formatScheduleDate(day.date),
        graded > 0 ? `${day.wins}–${day.losses}` : null,
        day.staked ? `net ${formatSignedMoney(day.net)}` : null,
        day.open > 0 ? `${day.open} open` : null,
        graded === 0 && day.open === 0 ? "void" : null,
      ]
        .filter(Boolean)
        .join(", ");
  return (
    // The day on /games, where each result shows the pick made on it.
    <Link
      href={`/games?date=${day.date}`}
      aria-label={label}
      className="mt-0.5 block px-1 py-0.5 hover:bg-tint"
    >
      {day.missed ? (
        <span className="block text-xs text-ink-3">No picks</span>
      ) : (
        <>
          {graded > 0 ? (
            <span
              className={cn(
                "block font-semibold tabular sm:text-base",
                tone === "won" && "text-primary",
                tone === "lost" && "text-destructive"
              )}
            >
              {day.wins}–{day.losses}
            </span>
          ) : null}
          {day.staked ? (
            <span
              className={cn(
                "block text-xs tabular",
                day.net > 0 ? "text-primary" : day.net < 0 ? "text-destructive" : "text-ink-2"
              )}
            >
              {formatSignedMoney(day.net)}
            </span>
          ) : null}
          {day.open > 0 ? <span className="block text-xs text-ink-2">{day.open} open</span> : null}
          {graded === 0 && day.open === 0 ? (
            <span className="block text-xs text-ink-3">Void</span>
          ) : null}
        </>
      )}
    </Link>
  );
}
