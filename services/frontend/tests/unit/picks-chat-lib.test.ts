import { describe, expect, it } from "vitest";

import { CHAT_STARTERS, followUps, sourceLabel } from "@/lib/chat";
import { PRIMARY_NAV, primaryNav } from "@/lib/nav";
import {
  bestCall,
  finalScore,
  formatMoney,
  formatPrice,
  formatSignedMoney,
  pickLabel,
  pickProfit,
} from "@/lib/picks";
import type { UserPick } from "@/lib/types";

function pick(overrides: Partial<UserPick> = {}): UserPick {
  return {
    game_id: "g",
    picked_team_id: "home",
    stake: null,
    moneyline: -150,
    result: "pending",
    profit: null,
    home_team_id: "home",
    home_team_abbreviation: "GSW",
    home_score: null,
    away_team_id: "away",
    away_team_abbreviation: "LAL",
    away_score: null,
    ...overrides,
  } as UserPick;
}

describe("pick labels", () => {
  it("writes the price with a real minus", () => {
    expect(formatPrice(159)).toBe("+159");
    expect(formatPrice(-145)).toBe("−145");
    expect(formatPrice(null)).toBe("");
    expect(formatPrice(undefined)).toBe("");
  });

  it("reads from the picked side: vs at home, at on the road", () => {
    expect(pickLabel(pick())).toBe("GSW −150 vs LAL");
    expect(pickLabel(pick({ picked_team_id: "away", moneyline: 130 }))).toBe("LAL +130 at GSW");
    expect(pickLabel(pick({ moneyline: null }))).toBe("GSW vs LAL");
  });

  it("says so when the game has left the schedule", () => {
    expect(pickLabel(pick({ home_team_abbreviation: null, home_team_id: null }))).toBe(
      "No longer scheduled"
    );
  });

  it("gives the final score winner first, and nothing before the game ends", () => {
    expect(finalScore(pick())).toBeNull();
    expect(finalScore(pick({ home_score: 120, away_score: 110 }))).toBe("GSW 120–110");
    expect(finalScore(pick({ home_score: 99, away_score: 104 }))).toBe("LAL 104–99");
    expect(
      finalScore(pick({ home_score: 99, away_score: 104, away_team_abbreviation: null }))
    ).toBe("104–99");
  });
});

describe("stakes", () => {
  it("pays at the moneyline to the cent, as the API settles it", () => {
    expect(pickProfit(10, 104)).toBe(10.4);
    expect(pickProfit(100, 130)).toBe(130);
    expect(pickProfit(100, -150)).toBe(66.66);
    expect(pickProfit(5, -192)).toBe(2.6);
  });

  it("writes whole dollars plainly and anything else with cents", () => {
    expect(formatMoney(10)).toBe("$10");
    expect(formatMoney(10.4)).toBe("$10.40");
    expect(formatMoney(1000)).toBe("$1,000");
  });

  it("signs a net with a real minus and no sign on zero", () => {
    expect(formatSignedMoney(37.15)).toBe("+$37.15");
    expect(formatSignedMoney(-50)).toBe("−$50");
    expect(formatSignedMoney(0)).toBe("$0");
  });
});

describe("best call", () => {
  it("is the biggest payout when anything was staked", () => {
    const picks = [
      pick({ game_id: "long", result: "won", moneyline: 400 }),
      pick({ game_id: "small", result: "won", moneyline: 159, stake: 10, profit: 15 }),
      pick({ game_id: "big", result: "won", moneyline: -150, stake: 300, profit: 200 }),
      pick({ game_id: "lost", result: "lost", moneyline: 500, stake: 900, profit: -900 }),
    ];
    expect(bestCall(picks)?.game_id).toBe("big");
  });

  it("falls back to the longest-odds win when nothing staked has won", () => {
    const picks = [
      pick({ game_id: "a", result: "won", moneyline: -200 }),
      pick({ game_id: "b", result: "won", moneyline: 159 }),
      pick({ game_id: "c", result: "lost", moneyline: 240 }),
      pick({ game_id: "d", result: "won", moneyline: null }),
      pick({ game_id: "e", result: "pending", moneyline: 400 }),
    ];
    expect(bestCall(picks)?.game_id).toBe("b");
    expect(bestCall([picks[2], picks[3], picks[4]])).toBeUndefined();
  });
});

describe("chat suggestions", () => {
  it("offers follow-ups for the tool the answer came from", () => {
    expect(followUps("cube tool get_standings")).toContain("And the other conference?");
    expect(followUps("cube tool get_team_record").length).toBeGreaterThan(0);
  });

  it("offers nothing for an unknown or missing source", () => {
    expect(followUps("cube tool query_cube")).toEqual([]);
    expect(followUps(null)).toEqual([]);
    expect(followUps(undefined)).toEqual([]);
  });

  it("turns a tool name into words a reader recognises", () => {
    expect(sourceLabel("cube tool get_team_record")).toBe("team record");
    expect(sourceLabel("cube tool query_cube")).toBe("query cube");
    expect(sourceLabel(null)).toBe("");
  });

  it("has starters to open with", () => {
    expect(CHAT_STARTERS.length).toBeGreaterThan(0);
  });
});

describe("primaryNav", () => {
  it("shows Ask when the chatbot is not available", () => {
    expect(primaryNav(false)).toEqual([...PRIMARY_NAV]);
  });

  it("puts Chat in Ask's place when it is, never both", () => {
    const tabs = primaryNav(true);
    expect(tabs).toHaveLength(PRIMARY_NAV.length);
    expect(tabs.map((tab) => tab.label)).not.toContain("Ask");
    const askIndex = PRIMARY_NAV.findIndex((tab) => tab.href === "/ask");
    expect(tabs[askIndex]).toEqual({ href: "/chat", label: "Chat" });
  });
});
