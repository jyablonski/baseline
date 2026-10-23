// Month-grid maths for the team calendar and the day pickers. Everything is an Eastern calendar
// date string ("2026-10-22") or month ("2026-10"): game dates are Eastern, and
// the account time zone only moves the tip time shown in a cell, never the day.

export type CalendarCell = { date: string; inMonth: boolean };

/** "2026-10" from "2026-10-22" or "2026-10-22T00:00:00". */
export function monthOf(date: string) {
  return date.slice(0, 7);
}

/** Midnight UTC on an Eastern calendar date, so formatting never shifts the day. */
export function utcDate(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

function isoOf(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** The month `delta` months from `month`. */
export function shiftMonth(month: string, delta: number) {
  const [year, index] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, index - 1 + delta, 1));
  return isoOf(shifted).slice(0, 7);
}

/**
 * Whole weeks, Sunday first, covering `month`. Days from the neighbouring
 * months fill the first and last weeks so every row has seven cells.
 */
export function monthGrid(month: string): CalendarCell[][] {
  const first = utcDate(`${month}-01`);
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const weeks: CalendarCell[][] = [];
  const cursor = new Date(start);
  do {
    const week: CalendarCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = isoOf(cursor);
      week.push({ date, inMonth: monthOf(date) === month });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (monthOf(isoOf(cursor)) === month);
  return weeks;
}

/** Every month from the first game's to the last game's, in order. */
export function seasonMonths(dates: string[]) {
  if (dates.length === 0) return [];
  const sorted = dates.map(monthOf).sort();
  const months = [sorted[0]];
  while (months.at(-1)! < sorted.at(-1)!) months.push(shiftMonth(months.at(-1)!, 1));
  return months;
}

/**
 * The month to open on: the one holding the next game from `today`, or the
 * last game's once the season is over. Today's month with no games at all.
 */
export function defaultMonth(dates: string[], today: string) {
  const sorted = dates.map((date) => date.slice(0, 10)).sort();
  if (sorted.length === 0) return monthOf(today);
  return monthOf(sorted.find((date) => date >= today) ?? sorted.at(-1)!);
}

/** "October 2026". */
export function formatMonth(month: string) {
  return utcDate(`${month}-01`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A real calendar date: "2026-02-30" parses, but rolls over to March. */
function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = utcDate(value);
  // An impossible month is an Invalid Date, whose toISOString throws.
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * The day on screen and the game days either side of it, for a day picker.
 * `home` is where the picker starts and its jump-back button goes: the newest
 * day for results, the soonest for the schedule. `requested` falls back to
 * `home` when it is missing or not a real date; a requested day with no games
 * is kept, so the page can say so, and steps to the nearest game days around it.
 */
export function dayNavigation(
  dates: { game_date: string }[],
  requested: string | null,
  start: "newest" | "oldest" = "newest"
) {
  const days = [...new Set(dates.map((item) => item.game_date.slice(0, 10)))].sort();
  const home = (start === "newest" ? days.at(-1) : days[0]) ?? null;
  const current = requested && isCalendarDate(requested) ? requested : home;
  if (!current) return { current: null, home: null, older: null, newer: null };
  const older = days.filter((day) => day < current).at(-1) ?? null;
  const newer = days.find((day) => day > current) ?? null;
  return { current, home, older, newer };
}
