import { describe, expect, it } from "vitest";

import {
  formatDailyRefresh,
  formatGameTime,
  formatScrapedAt,
  gamePhase,
  hasTipped,
  isTimezone,
  liveWindowStartDate,
  otherLocalDate,
  TIMEZONES,
} from "@/lib/timezones";

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

describe("formatDailyRefresh", () => {
  it("keeps the cron on UTC, so Eastern moves an hour with daylight saving", () => {
    expect(formatDailyRefresh(null, new Date("2026-10-22T03:00:00Z"))).toBe("8:00 AM ET");
    expect(formatDailyRefresh(null, new Date("2026-12-15T03:00:00Z"))).toBe("7:00 AM ET");
  });

  it("reads in the account's zone when one is chosen", () => {
    const summer = new Date("2026-10-22T03:00:00Z");
    expect(formatDailyRefresh("America/Los_Angeles", summer)).toBe("5:00 AM PDT");
    expect(formatDailyRefresh("UTC", summer)).toBe("12:00 PM UTC");
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

describe("gamePhase", () => {
  it("is live for three hours from tip, then started", () => {
    // 7:30 PM EDT is 23:30 UTC; three hours on is 02:30 UTC.
    expect(gamePhase("2026-10-22", "19:30", new Date("2026-10-22T23:29:00Z"))).toBe("upcoming");
    expect(gamePhase("2026-10-22", "19:30", new Date("2026-10-22T23:30:00Z"))).toBe("live");
    expect(gamePhase("2026-10-22", "19:30", new Date("2026-10-23T02:29:00Z"))).toBe("live");
    expect(gamePhase("2026-10-22", "19:30", new Date("2026-10-23T02:30:00Z"))).toBe("started");
  });

  it("never calls a game with no tip time live", () => {
    expect(gamePhase("2026-10-22", null, new Date("2026-10-22T03:59:00Z"))).toBe("upcoming");
    expect(gamePhase("2026-10-22", null, new Date("2026-10-22T05:00:00Z"))).toBe("started");
  });
});

describe("liveWindowStartDate", () => {
  it("is the Eastern date three hours ago", () => {
    // 1 AM EDT on the 23rd: a 10 PM tip on the 22nd is still live.
    expect(liveWindowStartDate(new Date("2026-10-23T05:00:00Z"))).toBe("2026-10-22");
    // 3:30 AM EDT: past every window from the night before.
    expect(liveWindowStartDate(new Date("2026-10-23T07:30:00Z"))).toBe("2026-10-23");
    // 9 PM EDT on the 22nd, when the server's UTC date is already the 23rd.
    expect(liveWindowStartDate(new Date("2026-10-23T01:00:00Z"))).toBe("2026-10-22");
  });
});

describe("otherLocalDate", () => {
  const local = (gameDate: string, tip: string | null, timezone: string | null) =>
    otherLocalDate(formatGameTime(gameDate, tip, timezone).date, gameDate);

  it("is null while the tip falls on the game's Eastern date", () => {
    expect(local("2026-10-24", "19:00", null)).toBeNull();
    expect(local("2026-10-24", "19:00", "America/Los_Angeles")).toBeNull();
    // No tip time: nothing to move the date.
    expect(local("2026-10-24", null, "Europe/London")).toBeNull();
  });

  it("names the local date once a late tip crosses midnight there", () => {
    // 10 PM EDT is 3 AM the next day in London.
    expect(local("2026-10-24", "22:00", "Europe/London")).toBe("Sun, Oct 25, 2026");
  });
});
