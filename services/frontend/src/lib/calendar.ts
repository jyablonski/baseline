// Month-grid maths for the team calendar. Everything is an Eastern calendar
// date string ("2026-10-22") or month ("2026-10"): game dates are Eastern, and
// the account time zone only moves the tip time shown in a cell, never the day.

export type CalendarCell = { date: string; inMonth: boolean };

/** "2026-10" from "2026-10-22" or "2026-10-22T00:00:00". */
export function monthOf(date: string) {
  return date.slice(0, 7);
}

function utcDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`);
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
