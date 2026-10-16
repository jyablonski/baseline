import { describe, expect, it } from "vitest";

import {
  defaultMonth,
  formatMonth,
  monthGrid,
  monthOf,
  seasonMonths,
  shiftMonth,
} from "@/lib/calendar";

describe("monthGrid", () => {
  it("covers the month in whole Sunday-first weeks", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const weeks = monthGrid("2026-10");
    expect(weeks).toHaveLength(5);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0][0]).toEqual({ date: "2026-09-27", inMonth: false });
    expect(weeks[0][4]).toEqual({ date: "2026-10-01", inMonth: true });
    expect(weeks.at(-1)!.at(-1)).toEqual({ date: "2026-10-31", inMonth: true });
  });

  it("adds a trailing week of the next month when needed", () => {
    // November 2026 ends on a Monday.
    const last = monthGrid("2026-11").at(-1)!;
    expect(last[1]).toEqual({ date: "2026-11-30", inMonth: true });
    expect(last[6]).toEqual({ date: "2026-12-05", inMonth: false });
  });

  it("handles a leap February", () => {
    const days = monthGrid("2028-02")
      .flat()
      .filter((cell) => cell.inMonth);
    expect(days).toHaveLength(29);
  });
});

describe("months", () => {
  it("shifts across a year boundary both ways", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(monthOf("2026-10-22T00:00:00")).toBe("2026-10");
  });

  it("lists every month of a season, including ones with no games", () => {
    expect(seasonMonths(["2027-01-03", "2026-10-22", "2027-03-01"])).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
    expect(seasonMonths([])).toEqual([]);
  });

  it("opens on the next game's month, else the last game's, else today's", () => {
    const dates = ["2026-10-22", "2026-11-30", "2027-04-12"];
    expect(defaultMonth(dates, "2026-09-01")).toBe("2026-10");
    expect(defaultMonth(dates, "2026-11-30")).toBe("2026-11");
    expect(defaultMonth(dates, "2026-12-01")).toBe("2027-04");
    expect(defaultMonth(dates, "2027-06-01")).toBe("2027-04");
    expect(defaultMonth([], "2027-06-01")).toBe("2027-06");
  });

  it("names a month in full", () => {
    expect(formatMonth("2026-10")).toBe("October 2026");
  });
});
