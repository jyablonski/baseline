"use client";

import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatMonth, monthGrid, monthOf, shiftMonth } from "@/lib/calendar";
import { formatDayShort } from "@/lib/results";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * ← [Sat, Jun 13 ▾] →: steps between game days, or opens a month grid where
 * only days with games can be picked. Days off are skipped either way.
 */
export function DayPicker({
  current,
  latest,
  older,
  newer,
  gameDays,
  onPick,
}: {
  current: string;
  latest: string;
  older: string | null;
  newer: string | null;
  /** Every date with a game, newest first. */
  gameDays: string[];
  onPick: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthOf(current));
  const days = new Set(gameDays);
  const firstMonth = monthOf(gameDays.at(-1) ?? current);
  const lastMonth = monthOf(latest);

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
          className="flex h-[var(--ct-control-page)] items-center gap-2 border-x border-rule-strong px-4 font-semibold hover:bg-tint"
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
              disabled={current === latest}
              onClick={() => pick(latest)}
            >
              Latest
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
