import { describe, expect, it } from "vitest";

import {
  closestRow,
  comebackRow,
  marginRow,
  notableTab,
  oneIn,
  rowLine,
  upsetRow,
} from "@/lib/notables";
import type { ClosestGame, GameCollapse, GameUpset } from "@/lib/types";

const COLLAPSE: GameCollapse = {
  game_id: "g-collapse",
  season: "2025-26",
  game_date: "2026-02-26",
  home_team_abbreviation: "LAL",
  home_score: 120,
  away_team_abbreviation: "SAC",
  away_score: 123,
  largest_lead_blown: 26,
  blown_lead_team_abbreviation: "LAL",
  comeback_team_abbreviation: "SAC",
  blown_lead_period: 2,
};

const UPSET: GameUpset = {
  game_id: "g-upset",
  season: "2025-26",
  game_date: "2026-01-09",
  home_team_id: "t-den",
  home_team_abbreviation: "DEN",
  away_team_id: "t-was",
  away_team_abbreviation: "WAS",
  home_score: 112,
  away_score: 118,
  winner_location: "away",
  winner_market_wp: 0.08,
  upset_magnitude: 2.5,
  winner_fair_moneyline: 1100,
  home_wins: 26,
  home_losses: 12,
  away_wins: 10,
  away_losses: 28,
  home_notable_out: [],
  away_notable_out: [],
};

const CLOSEST: ClosestGame = {
  game_id: "g-close",
  game_date: "2026-03-09",
  home_team_abbreviation: "LAC",
  home_score: 127,
  away_team_abbreviation: "GSW",
  away_score: 128,
  winning_team_abbreviation: "GSW",
  final_margin: 1,
  lead_changes: 24,
  overtime_periods: 2,
};

describe("notableTab", () => {
  it("defaults to comebacks for a missing or unknown tab", () => {
    expect(notableTab(null)).toBe("comebacks");
    expect(notableTab("nope")).toBe("comebacks");
    expect(notableTab("upsets")).toBe("upsets");
    expect(notableTab("closest")).toBe("closest");
    expect(notableTab("margins")).toBe("margins");
  });
});

describe("oneIn", () => {
  it("rounds the odds to a whole number", () => {
    expect(oneIn(0.08)).toBe("1 in 13");
    expect(oneIn(0.24)).toBe("1 in 4");
    expect(oneIn(0.49)).toBe("1 in 2");
  });
});

describe("comebackRow", () => {
  it("reads from the side that came back by default", () => {
    const row = comebackRow(COLLAPSE);
    expect(rowLine(row)).toBe("SAC beat LAL, 123–120");
    expect(row.context).toBe("trailed by 26 in Q2");
    expect(row.headline).toBe("26 pts");
    expect(row.secondary).toBe("Won by 3");
    expect(row.tag).toBeNull();
  });

  it("reads from the side that blew it when that team is picked", () => {
    const row = comebackRow(COLLAPSE, "LAL");
    expect(rowLine(row)).toBe("LAL lost to SAC, 120–123");
    expect(row.context).toBe("led by 26 in Q2");
    expect(row.secondary).toBe("Lost by 3");
    expect(row.tag).toEqual({ label: "Blew it", tone: "loss" });
    expect(comebackRow(COLLAPSE, "SAC").tag).toEqual({ label: "Came back", tone: "win" });
  });

  it("leaves out the quarter and margin it does not know", () => {
    const row = comebackRow({ ...COLLAPSE, blown_lead_period: null, home_score: null });
    expect(row.context).toBe("trailed by 26");
    expect(rowLine(row)).toBe("SAC beat LAL");
    expect(row.secondary).toBe("—");
  });
});

describe("upsetRow", () => {
  it("shows how unlikely the win was, the line, and both records", () => {
    const row = upsetRow(UPSET);
    expect(rowLine(row)).toBe("WAS won at DEN, 118–112");
    expect(row.headline).toBe("8%");
    expect(row.headlineNote).toBe("1 in 13");
    expect(row.secondary).toBe("+1100");
    expect(row.context).toBe("10–28 vs 26–12");
    expect(row.note).toBeNull();
  });

  it("drops opening-night 0–0 records and names notable absences", () => {
    const row = upsetRow({
      ...UPSET,
      home_wins: 0,
      home_losses: 0,
      away_wins: 0,
      away_losses: 0,
      home_notable_out: ["Nikola Jokić"],
      model_called_upset: true,
      winner_fair_moneyline: null,
    });
    expect(row.context).toBe("DEN without Nikola Jokić");
    expect(row.note).toBe("Model called it");
    expect(row.secondary).toBe("—");
  });

  it("tags an upset win or loss for the picked team", () => {
    expect(upsetRow(UPSET, "WAS").tag).toEqual({ label: "Upset win", tone: "win" });
    const loss = upsetRow(UPSET, "DEN");
    expect(loss.tag).toEqual({ label: "Upset loss", tone: "loss" });
    expect(rowLine(loss)).toBe("DEN lost vs WAS, 112–118");
    expect(loss.context).toBe("26–12 vs 10–28");
  });

  it("says vs for a home underdog", () => {
    const row = upsetRow({ ...UPSET, winner_location: "home" });
    expect(rowLine(row)).toBe("DEN won vs WAS, 112–118");
  });
});

describe("closestRow", () => {
  it("leads with the winner and marks overtime", () => {
    const row = closestRow(CLOSEST);
    expect(rowLine(row)).toBe("GSW beat LAC, 128–127");
    expect(row.context).toBe("2OT");
    expect(row.headline).toBe("1 pt");
    expect(row.secondary).toBe("24");
  });

  it("reads from the loser when it is picked, and shows unknown lead changes as a dash", () => {
    const row = closestRow({ ...CLOSEST, overtime_periods: 1, lead_changes: null }, "LAC");
    expect(rowLine(row)).toBe("LAC lost to GSW, 127–128");
    expect(row.context).toBe("OT");
    expect(row.secondary).toBe("—");
    expect(closestRow({ ...CLOSEST, overtime_periods: 0, final_margin: 3 }).context).toBeNull();
    expect(closestRow({ ...CLOSEST, final_margin: 3 }).headline).toBe("3 pts");
  });
});

describe("marginRow", () => {
  const BLOWOUT = {
    game_id: "g-margin",
    game_date: "2025-12-12",
    home_team_abbreviation: "OKC",
    home_score: 141,
    away_team_abbreviation: "POR",
    away_score: 94,
    winning_team_abbreviation: "OKC",
    final_margin: 47,
    is_wire_to_wire: true,
  };

  it("keeps the score in its own column and notes wire to wire", () => {
    const row = marginRow(BLOWOUT);
    expect(rowLine(row)).toBe("OKC beat POR");
    expect(row.context).toBe("never trailed");
    expect(row.headline).toBe("47 pts");
    expect(row.secondary).toBe("141–94");
  });

  it("reads from the loser when it is picked", () => {
    const row = marginRow(BLOWOUT, "POR");
    expect(rowLine(row)).toBe("POR lost to OKC");
    expect(row.context).toBe("never led");
    expect(row.secondary).toBe("94–141");
    expect(marginRow({ ...BLOWOUT, is_wire_to_wire: null }).context).toBeNull();
  });
});
