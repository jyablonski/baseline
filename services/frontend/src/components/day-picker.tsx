"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatMonth, monthGrid, monthOf, shiftMonth } from "@/lib/calendar";
import { formatDayShort } from "@/lib/results";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * "Calendar ▾": a month grid where only days with games can be picked, with a
 * button back to `home`. Sits at the end of the Games week strip.
 */
export function DayCalendar({
  current,
  home,
  homeLabel,
  gameDays,
  onPick,
  className,
}: {
  current: string;
  /** Where the jump-back button goes. */
  home: string;
  /** That button's name: "Today" on /games. */
  homeLabel: string;
  /** Every date with a game, in any order. */
  gameDays: string[];
  onPick: (date: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthOf(current));
  const days = new Set(gameDays);
  const sorted = [...days].sort();
  // The grid spans every game day, and the day on screen if it falls outside them.
  const months = [sorted[0] ?? current, sorted.at(-1) ?? current, current].map(monthOf).sort();
  const firstMonth = months[0];
  const lastMonth = months[2];

  function pick(date: string) {
    setOpen(false);
    onPick(date);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Reopening starts on the month of the day on screen.
        if (next) setMonth(monthOf(current));
        setOpen(next);
      }}
    >
      <PopoverTrigger
        className={cn(
          "flex items-center justify-center gap-2 px-3 whitespace-nowrap hover:bg-tint sm:px-4",
          className
        )}
        aria-label={`Pick a game day, showing ${formatDayShort(current)}`}
      >
        {/* Phones keep the room for the days: an icon stands in for the word. */}
        <CalendarDays aria-hidden="true" className="size-4 sm:hidden" />
        <span className="max-sm:hidden">Calendar</span>
        <span aria-hidden="true" className="text-xs text-ink-2 max-sm:hidden">
          ▾
        </span>
      </PopoverTrigger>
      <PopoverContent
        title={formatMonth(month)}
        align="end"
        className="w-[min(320px,calc(100vw-24px))]"
        aside={
          <span className="flex gap-1">
            <button
              type="button"
              className="px-1 text-ink-2 hover:text-foreground disabled:text-ink-3"
              disabled={month <= firstMonth}
              onClick={() => setMonth((value) => shiftMonth(value, -1))}
              aria-label="Previous month"
            >
              ←
            </button>
            <button
              type="button"
              className="px-1 text-ink-2 hover:text-foreground disabled:text-ink-3"
              disabled={month >= lastMonth}
              onClick={() => setMonth((value) => shiftMonth(value, 1))}
              aria-label="Next month"
            >
              →
            </button>
          </span>
        }
      >
        <table className="w-full table-fixed text-center text-sm">
          <thead>
            <tr>
              {WEEKDAYS.map((day, index) => (
                <th key={index} scope="col" className="type-eyebrow pb-1 font-normal">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthGrid(month).map((week) => (
              <tr key={week[0].date}>
                {week.map((cell) => {
                  if (!cell.inMonth) return <td key={cell.date} />;
                  const hasGames = days.has(cell.date);
                  const selected = cell.date === current;
                  return (
                    <td key={cell.date} className="p-0.5">
                      <button
                        type="button"
                        disabled={!hasGames}
                        aria-pressed={selected}
                        aria-label={`${formatDayShort(cell.date)}${hasGames ? "" : ", no games"}`}
                        onClick={() => pick(cell.date)}
                        className={cn(
                          "relative flex h-9 w-full flex-col items-center justify-center tabular",
                          hasGames ? "font-semibold hover:bg-tint" : "cursor-default text-ink-3",
                          selected && "bg-foreground text-background hover:bg-foreground"
                        )}
                      >
                        {Number(cell.date.slice(8, 10))}
                        {hasGames ? (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "absolute bottom-1 size-1 rounded-full",
                              selected ? "bg-background" : "bg-primary"
                            )}
                          />
                        ) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex items-center justify-between border-t border-rule pt-2 text-xs">
          <span className="text-ink-2">Dots mark game days</span>
          <button
            type="button"
            className="text-primary hover:underline disabled:text-ink-3 disabled:no-underline"
            disabled={current === home}
            onClick={() => pick(home)}
          >
            {homeLabel}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The title row over a day of games on /games: "Today · Sunday, November 22"
 * with its summary beside it, and controls (the My teams switch) on the right.
 */
export function DayHeader({
  title,
  summary,
  children,
}: {
  title: string;
  /** "7 games · PST", maybe with a legend; omitted while the day loads. */
  summary?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="type-module whitespace-nowrap">{title}</h2>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">{summary}</p>
      </div>
      {children}
    </div>
  );
}
