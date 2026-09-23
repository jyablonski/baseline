import { describe, expect, it } from "vitest";

import {
  formatArenaCoords,
  formatArenaLine,
  formatBirthDate,
  formatDate,
  formatGamesBack,
  formatMoneyline,
  formatNumber,
  formatProbability,
  formatScrapedAt,
  formatSignedMargin,
  formatStat,
  formatUsd,
  formatUsdCompact,
  formatUsdMillions,
  formatOrdinal,
  formatRecord,
  formatRecordWithWinPct,
  formatSeasonType,
  formatSpread,
  formatWinPct,
  formatWinPctPlain,
  teamCentricMargin,
  locationLabel,
  playerSubtitle,
  seasonFromDate,
  taxApronStatus,
} from "@/lib/format";

describe("format helpers", () => {
  it("formats numbers and stats", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(Number.NaN)).toBe("—");
    expect(formatNumber(1500)).toBe((1500).toLocaleString());
    expect(formatStat(27.14)).toBe(
      (27.1).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    );
  });

  it("formats win percentage", () => {
    expect(formatWinPct(null)).toBe("—");
    expect(formatWinPct(0.667)).toBe("66.7%");
    expect(formatWinPct(66.7)).toBe("66.7%");
    expect(formatWinPctPlain(null)).toBe("—");
    expect(formatWinPctPlain(0.774)).toBe(".774");
    expect(formatWinPctPlain(1)).toBe("1.000");
    expect(formatRecord(56, 26)).toBe("56–26");
    expect(formatRecord(null, 26)).toBe("—");
    expect(formatRecordWithWinPct(56, 26, 0.683)).toBe("56–26 | 68.3%");
    expect(formatRecordWithWinPct(null, 26, 0.683)).toBe("—");
    expect(formatRecordWithWinPct(56, 26, null)).toBe("56–26 | —");
    expect(teamCentricMargin(98, 110, 12, false)).toBe(-12);
    expect(teamCentricMargin(125, 113, 12, true)).toBe(12);
    expect(teamCentricMargin(null, null, 12, false)).toBe(-12);
    expect(teamCentricMargin(null, null, 12, true)).toBe(12);
  });

  it("formats dates and seasons", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not-a-date")).toBe("not-a-date");
    expect(formatDate("2024-10-22")).toContain("2024");
    expect(seasonFromDate("bad")).toBe("Unknown");
    expect(seasonFromDate("2024-10-22")).toBe("2024-25");
    expect(seasonFromDate("2025-01-15")).toBe("2024-25");
  });

  it("labels locations", () => {
    expect(locationLabel(null)).toBe("—");
    expect(locationLabel("home")).toBe("Home");
    expect(locationLabel("away")).toBe("Away");
    expect(locationLabel("neutral")).toBe("neutral");
  });

  it("labels gold season types", () => {
    expect(formatSeasonType(null)).toBe("—");
    expect(formatSeasonType("Regular Season")).toBe("Regular Season");
    expect(formatSeasonType("Cup")).toBe("NBA Cup");
    expect(formatSeasonType("Playoffs")).toBe("Playoffs");
    expect(formatSeasonType("PlayIn")).toBe("Play-in");
    expect(formatSeasonType("play-in")).toBe("Play-in");
  });

  it("formats USD dollars and games back", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(Number.NaN)).toBe("—");
    expect(formatUsd(50_000_000)).toBe(
      (50_000_000).toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })
    );
    expect(formatGamesBack(null)).toBe("—");
    expect(formatGamesBack(0)).toBe("—");
    expect(formatGamesBack(1.5)).toBe("1.5 GB");
    expect(formatUsdCompact(null)).toBe("—");
    expect(formatUsdCompact(52_400_000)).toBe("$52.4M");
    expect(formatUsdCompact(50_000_000)).toBe("$50M");
    expect(formatUsdMillions(null)).toBe("—");
    expect(formatUsdMillions(400_000)).toBe("$0.4M");
    expect(formatUsdMillions(20_900_000)).toBe("$20.9M");
    expect(formatUsdMillions(50_000_000)).toBe("$50M");
    expect(formatOrdinal(null)).toBe("—");
    expect(formatOrdinal(1)).toBe("1st");
    expect(formatOrdinal(2)).toBe("2nd");
    expect(formatOrdinal(3)).toBe("3rd");
    expect(formatOrdinal(4)).toBe("4th");
    expect(formatOrdinal(11)).toBe("11th");
    expect(formatOrdinal(21)).toBe("21st");
    expect(formatUsdCompact(500)).toBe(
      (500).toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })
    );
    expect(formatSignedMargin(null)).toBe("—");
    expect(formatSignedMargin(9)).toBe("+9");
    expect(formatSignedMargin(-3)).toBe("-3");
    expect(formatSignedMargin(4.1, 1)).toBe(
      `+${(4.1).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`
    );
    expect(formatSignedMargin(0, 1)).toBe(
      (0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    );
    expect(formatScrapedAt(null)).toBe("—");
    expect(formatScrapedAt("nope")).toBe("—");
    expect(formatScrapedAt("2026-09-04T04:12:00Z")).toMatch(/4 Sep[t]? 2026, 04:12 UTC/);
    expect(formatBirthDate(null)).toBeNull();
    expect(formatBirthDate("not-a-date")).toBe("not-a-date");
    expect(formatBirthDate("1991-06-29")).toContain("1991");
  });

  it("formats arena coordinates and label lines", () => {
    expect(formatArenaCoords(null, -122.3875)).toBeNull();
    expect(formatArenaCoords(37.76806, null)).toBeNull();
    expect(formatArenaCoords(37.76806, -122.3875)).toBe("37.7681, -122.3875");
    expect(formatArenaLine({ arena_name: "Chase Center" })).toBe("Chase Center");
    expect(
      formatArenaLine({
        arena_name: "Chase Center",
        arena_latitude: 37.76806,
        arena_longitude: -122.3875,
      })
    ).toBe("Chase Center · 37.7681, -122.3875");
    expect(formatArenaLine({})).toBeNull();
  });

  it("formats scrape watermarks, money, and identity extras", () => {
    expect(formatScrapedAt(null)).toBe("—");
    expect(formatScrapedAt("not-a-date")).toBe("—");
    expect(formatScrapedAt("2026-09-04T04:12:00Z")).toContain("2026");
    expect(formatScrapedAt("2026-09-04T04:12:00Z")).toContain("UTC");
    expect(formatUsdCompact(null)).toBe("—");
    expect(formatUsdCompact(50_000_000)).toBe("$50M");
    expect(formatUsdCompact(1_500_000)).toBe("$1.5M");
    expect(formatUsdCompact(500)).toContain("500");
    expect(formatSignedMargin(null)).toBe("—");
    expect(formatSignedMargin(8)).toBe("+8");
    expect(formatSignedMargin(-3)).toBe("-3");
    expect(formatBirthDate(null)).toBeNull();
    expect(formatBirthDate("not-a-date")).toBe("not-a-date");
    expect(formatBirthDate("1991-06-29")).toMatch(/^b\. /);
    expect(formatWinPctPlain(null)).toBe("—");
    expect(formatWinPctPlain(0.61)).toMatch(/\.610/);
    expect(formatWinPctPlain(61)).toMatch(/\.610/);
  });

  it("omits empty compare subtitles and formats tax/apron status", () => {
    expect(playerSubtitle(null, null)).toBe("");
    expect(playerSubtitle("—", "")).toBe("");
    expect(playerSubtitle("LAL", "F")).toBe("LAL · F");
    expect(playerSubtitle(null, "F")).toBe("F");
    expect(taxApronStatus({})).toBeNull();
    expect(
      taxApronStatus({
        over_luxury_tax: true,
        over_first_apron: true,
        over_second_apron: false,
      })
    ).toBe("Over tax · over 1st apron · under 2nd apron");
  });
});

describe("odds and probability formatters", () => {
  it("formats probabilities as whole percents and dashes nulls", () => {
    expect(formatProbability(0.623)).toBe("62%");
    expect(formatProbability(null)).toBe("—");
  });

  it("signs moneylines and spreads", () => {
    expect(formatMoneyline(130)).toBe("+130");
    expect(formatMoneyline(-150)).toBe("-150");
    expect(formatMoneyline(null)).toBe("—");
    expect(formatSpread(-3.5)).toBe("-3.5");
    expect(formatSpread(4)).toBe("+4.0");
    expect(formatSpread(0)).toBe("PK");
    expect(formatSpread(undefined)).toBe("—");
  });
});
