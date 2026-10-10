import { describe, expect, it } from "vitest";

import { formatGameTime, isTimezone, TIMEZONES } from "@/lib/timezones";

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
