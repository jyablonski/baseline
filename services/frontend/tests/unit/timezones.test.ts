import { describe, expect, it } from "vitest";

import { formatGameTime, formatScrapedAt, hasTipped, isTimezone, TIMEZONES } from "@/lib/timezones";

describe("formatGameTime", () => {
  it("shows Eastern by default, exactly as the game is stored", () => {
    const eastern = { date: "Thu, Oct 22, 2026", time: "7:30 PM", zone: "ET" };
    expect(formatGameTime("2026-10-22", "19:30:00", null)).toEqual(eastern);
    expect(formatGameTime("2026-10-22T00:00:00", "19:30", undefined)).toEqual(eastern);
    expect(formatGameTime("2026-10-22", "19:30:00", "America/New_York")).toEqual(eastern);
  });

  it("shifts the time into the chosen zone and names it", () => {
    expect(formatGameTime("2026-10-22", "19:30:00", "America/Los_Angeles")).toEqual({
      date: "Thu, Oct 22, 2026",
      time: "4:30 PM",
      zone: "PDT",
    });
    // Arizona keeps standard time, so its gap to Eastern changes with the season.
    expect(formatGameTime("2026-10-22", "19:30:00", "America/Phoenix").time).toBe("4:30 PM");
    expect(formatGameTime("2027-01-15", "19:30:00", "America/Phoenix").time).toBe("5:30 PM");
  });

  it("moves the date when the shift crosses midnight", () => {
    expect(formatGameTime("2026-10-22", "22:00:00", "Europe/London")).toMatchObject({
      date: "Fri, Oct 23, 2026",
      time: "3:00 AM",
    });
    expect(formatGameTime("2027-01-15", "19:00:00", "UTC")).toEqual({
      date: "Sat, Jan 16, 2027",
      time: "12:00 AM",
      zone: "UTC",
    });
  });

  it("leaves the Eastern date alone when there is no time to shift", () => {
    for (const time of [null, undefined, "", "TBD", "25:00:00", "12:75"]) {
      expect(formatGameTime("2026-10-22", time, "Asia/Tokyo")).toEqual({
        date: "Thu, Oct 22, 2026",
        time: "TBD",
        zone: "",
      });
    }
    expect(formatGameTime(null, "19:30:00", "Asia/Tokyo")).toEqual({
      date: "—",
      time: "TBD",
      zone: "",
    });
  });
});

describe("the offered time zones", () => {
  it("are all names this runtime can format", () => {
    for (const zone of TIMEZONES) {
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: zone.value })).not.toThrow();
      expect(isTimezone(zone.value)).toBe(true);
    }
    expect(isTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isTimezone(null)).toBe(false);
  });
});

describe("formatScrapedAt", () => {
  it("shows Eastern by default and the account's zone when one is chosen", () => {
    expect(formatScrapedAt("2026-10-08T02:27:00Z", null)).toBe(
      "Wednesday, Oct 7, 2026 · 10:27 PM ET"
    );
    expect(formatScrapedAt("2026-10-08T02:27:00Z", "America/Los_Angeles")).toBe(
      "Wednesday, Oct 7, 2026 · 7:27 PM PDT"
    );
    expect(formatScrapedAt("2026-10-08T02:27:00Z", "UTC")).toBe(
      "Thursday, Oct 8, 2026 · 2:27 AM UTC"
    );
  });

  it("falls back to a dash without a usable timestamp", () => {
    expect(formatScrapedAt(null, null)).toBe("—");
    expect(formatScrapedAt("nope", null)).toBe("—");
  });
});

describe("hasTipped", () => {
  it("compares the Eastern tip-off to now", () => {
    // 7:30 PM EDT is 23:30 UTC.
    expect(hasTipped("2026-10-22", "19:30", new Date("2026-10-22T23:29:00Z"))).toBe(false);
    expect(hasTipped("2026-10-22", "19:30", new Date("2026-10-22T23:30:00Z"))).toBe(true);
  });

  it("locks from the start of game day with no tip time, as the API does", () => {
    // Midnight EDT is 04:00 UTC.
    expect(hasTipped("2026-10-22", null, new Date("2026-10-22T03:59:00Z"))).toBe(false);
    expect(hasTipped("2026-10-22", null, new Date("2026-10-22T04:00:00Z"))).toBe(true);
  });

  it("is false without a usable date", () => {
    expect(hasTipped(null, "19:30")).toBe(false);
  });
});
