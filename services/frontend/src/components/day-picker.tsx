"use client";

import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatMonth, monthGrid, monthOf, shiftMonth } from "@/lib/calendar";
import { formatDayShort } from "@/lib/results";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * ← [Sat, Jun 13 ▾] →: steps between game days, or opens a month grid where
 * only days with games can be picked. Days off are skipped either way. Shared
 * by /games (finished days, home is the newest) and /schedule (days still to
 * play, home is the soonest); `dayNavigation` works out the neighbours.
 */
export function DayPicker({
  current,
  home,
  homeLabel,
  older,
  newer,
  gameDays,
  onPick,
}: {
  current: string;
  /** Where the jump-back button goes. */
  home: string;
  /** That button's name: "Latest" for results, "Today" or "Next up" for the schedule. */
  homeLabel: string;
  older: string | null;
  newer: string | null;
  /** Every date with a game, in any order. */
  gameDays: string[];
  onPick: (date: string) => void;
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
    <div className="flex border border-rule-strong" role="group" aria-label="Game day">
      <button
        type="button"
        className="px-3 text-ink-2 hover:bg-tint hover:text-foreground disabled:text-ink-3 disabled:hover:bg-transparent"
        disabled={!older}
        onClick={() => older && onPick(older)}
        aria-label="Earlier game day"
      >
        ←
      </button>
      <Popover
        open={open}
        onOpenChange={(next) => {
          // Reopening starts on the month of the day on screen.
          if (next) setMonth(monthOf(current));
          setOpen(next);
        }}
      >
        <PopoverTrigger
          // A fixed width (the widest date, "Wed, Dec 16", fits) so the arrows never
          // move as the day changes, and sit in the same place on /games and /schedule.
          className="flex h-[var(--ct-control-page)] min-w-[9.5em] items-center justify-center gap-2 border-x border-rule-strong px-4 font-semibold hover:bg-tint"
          aria-label={`Pick a game day, showing ${formatDayShort(current)}`}
        >
          <span className="tabular">{formatDayShort(current)}</span>
          <span aria-hidden="true" className="text-xs text-ink-2">
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
      <button
        type="button"
        className="px-3 text-ink-2 hover:bg-tint hover:text-foreground disabled:text-ink-3 disabled:hover:bg-transparent"
        disabled={!newer}
        onClick={() => newer && onPick(newer)}
        aria-label="Later game day"
      >
        →
      </button>
    </div>
  );
}

/**
 * The title row over a day of games, shared by /games and /schedule so the two
 * line up: "Latest · Saturday, June 13" with a count under it, the picker on
 * the right, and a rule beneath. `rule` is light where a table head right below
 * already draws the strong line.
 */
export function DayHeader({
  title,
  summary,
  rule = "strong",
  children,
}: {
  title: string;
  /** The line under the title ("Finals · 3 games"); omitted while the day loads. */
  summary?: string | null;
  rule?: "strong" | "light";
  /** The DayPicker. */
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-3 border-b pb-3",
        rule === "strong" ? "border-rule-strong" : "border-rule"
      )}
    >
      <div>
        <h2 className="type-module">{title}</h2>
        {/* Holds its line while empty, so the rule does not jump as a day loads. */}
        <p className="mt-0.5 min-h-[1lh] text-xs text-ink-2">{summary}</p>
      </div>
      {children}
    </div>
  );
}
