"use client";

import { useEffect, useRef } from "react";

import { utcDate } from "@/lib/calendar";
import type { GameDay } from "@/lib/types";
import { cn } from "@/lib/utils";

/** "Thu 19". */
function cellLabel(date: string) {
  const day = utcDate(date);
  const weekday = day.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${weekday} ${day.getUTCDate()}`;
}

/** The line under a day: "Today · 7", "6 final", "3 games" or "No games". */
function dayMeta(date: string, today: string, count: GameDay | undefined) {
  const total = count?.total ?? 0;
  if (date === today) return total > 0 ? `Today · ${total}` : "Today";
  if (total === 0) return "No games";
  // A past day reads by its finals; one still missing a final falls back to the count.
  if (date < today && count && count.final > 0) return `${count.final} final`;
  return `${total} ${total === 1 ? "game" : "games"}`;
}

/**
 * ← [seven days] → [Calendar ▾]. Each day shows its game count; the day on
 * screen is filled dark and today, when it is not, is shaded. On phones the
 * days scroll sideways and the one on screen is kept in view.
 */
export function WeekStrip({
  days,
  selected,
  today,
  counts,
  onPick,
  onShiftWeek,
  calendar,
}: {
  /** Seven dates, oldest first. */
  days: string[];
  selected: string;
  today: string;
  /** Counts by date; a date missing from it has no games. Undefined while loading. */
  counts: Map<string, GameDay> | undefined;
  onPick: (date: string) => void;
  onShiftWeek: (weeks: number) => void;
  calendar: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scroller.current;
    const cell = container?.querySelector<HTMLElement>('[aria-current="date"]');
    if (!container || !cell) return;
    // Scrolled by hand rather than scrollIntoView, which would also move the page.
    const left = cell.offsetLeft - container.offsetLeft;
    const right = left + cell.offsetWidth;
    if (left < container.scrollLeft) container.scrollLeft = left;
    else if (right > container.scrollLeft + container.clientWidth) {
      container.scrollLeft = right - container.clientWidth;
    }
  }, [selected]);

  const arrow =
    "shrink-0 px-3 text-ink-2 hover:bg-tint hover:text-foreground sm:px-4 focus-visible:relative";
  return (
    <div className="flex border border-rule-strong bg-raised" role="group" aria-label="Game days">
      <button
        type="button"
        className={cn(arrow, "border-r border-rule-strong")}
        onClick={() => onShiftWeek(-1)}
        aria-label="Previous week"
      >
        ←
      </button>
      <div
        ref={scroller}
        className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {days.map((date) => {
          const isSelected = date === selected;
          const isToday = date === today;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onPick(date)}
              aria-current={isSelected ? "date" : undefined}
              data-testid="week-day"
              className={cn(
                "flex min-w-[5.5rem] flex-1 flex-col items-center justify-center gap-0.5 border-r border-rule px-2 py-2.5 last:border-r-0 whitespace-nowrap",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : cn("hover:bg-tint", isToday && "bg-[#ece8df]")
              )}
            >
              <span className="text-sm font-semibold">{cellLabel(date)}</span>
              <span
                className={cn(
                  "min-h-[1lh] text-xs tabular",
                  isSelected ? "text-primary-foreground/80" : "text-ink-2"
                )}
              >
                {counts ? dayMeta(date, today, counts.get(date)) : null}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={cn(arrow, "border-x border-rule-strong")}
        onClick={() => onShiftWeek(1)}
        aria-label="Next week"
      >
        →
      </button>
      {calendar}
    </div>
  );
}
