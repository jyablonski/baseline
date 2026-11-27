import { describe, expect, it } from "vitest";

import { CHAT_STARTERS, followUps, sourceLabel } from "@/lib/chat";
import { PRIMARY_NAV, primaryNav } from "@/lib/nav";
import {
  bestCall,
  filterSettled,
  finalScore,
  formatMarketEdge,
  formatMoney,
  formatPrice,
  formatSignedMoney,
  marketTotals,
  modelTeam,
  monthPickSummary,
  openSummary,
  pickDays,
  pickLabel,
  pickProfit,
  picksCsv,
  pickTotals,
  recentForm,
  splitLabel,
  toggleSplit,
  type SettledFilters,
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

describe("against the market", () => {
  it("counts only settled picks that had a line", () => {
    const totals = marketTotals([
      pick({ result: "won", market_wp: 0.7 }),
      pick({ result: "lost", market_wp: 0.4 }),
      pick({ result: "won", market_wp: null }),
      pick({ result: "pending", market_wp: 0.5 }),
      pick({ result: "void", market_wp: 0.5 }),
    ]);
    expect(totals.games).toBe(2);
    expect(totals.wins).toBe(1);
    expect(totals.expected).toBeCloseTo(1.1);
    expect(totals.edge).toBeCloseTo(-0.1);
  });

  it("writes the edge to one decimal with a real minus", () => {
    expect(formatMarketEdge(4.06)).toBe("+4.1");
    expect(formatMarketEdge(-0.3)).toBe("−0.3");
    expect(formatMarketEdge(0.04)).toBe("0.0");
    expect(formatMarketEdge(-0.04)).toBe("0.0");
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

describe("picksCsv", () => {
  it("writes a header and one row per pick, blank where nothing is known", () => {
    const csv = picksCsv([
      pick({
        game_date: "2026-10-22T00:00:00",
        start_time_et: "19:30:00",
        stake: 50,
        result: "won",
        profit: 33.33,
        home_score: 112,
        away_score: 108,
        created_at: "2026-10-09T12:00:00Z",
      }),
      pick({ picked_team_id: "away", moneyline: null, game_date: null, start_time_et: null }),
    ]).split("\n");
    expect(csv[0]).toBe(
      "game_date,start_time_et,away_team,home_team,picked_team,moneyline,stake,result,profit,away_score,home_score,picked_at"
    );
    expect(csv[1]).toBe(
      "2026-10-22,19:30:00,LAL,GSW,GSW,-150,50,won,33.33,108,112,2026-10-09T12:00:00Z"
    );
    expect(csv[2]).toBe(",,LAL,GSW,LAL,,,pending,,,,");
  });

  it("quotes a value that would break a row", () => {
    const csv = picksCsv([pick({ home_team_abbreviation: 'G"S,W' })]);
    expect(csv.split("\n")[1]).toContain('"G""S,W"');
  });
});

describe("picks page summaries", () => {
  const now = new Date("2026-10-30T16:00:00Z");
  const filters: SettledFilters = { range: "season", result: "all", team: "", splits: [] };

  it("totals to the cent and leaves void picks out", () => {
    const totals = pickTotals([
      pick({ result: "won", stake: 10, profit: 0.1 }),
      pick({ result: "won", stake: 10, profit: 0.2 }),
      pick({ result: "void", stake: 10 }),
    ]);
    expect(totals).toEqual({ wins: 2, losses: 0, net: 0.3, staked: 20 });
  });

  it("compares the window with the season only when they differ", () => {
    const won = pick({ result: "won" });
    const lost = pick({ result: "lost" });
    expect(recentForm([won, lost], 2).trend).toBeNull();
    expect(recentForm([lost, lost, won], 2).trend).toBe("worse than your season");
    expect(recentForm([won, lost, won, lost], 2).trend).toBe("level with your season");
    // Oldest first, skipping void.
    expect(recentForm([won, pick({ result: "void" }), lost]).picks.map((p) => p.result)).toEqual([
      "lost",
      "won",
    ]);
  });

  it("works out the model's side from the result", () => {
    const final = { home_score: 2, away_score: 1 };
    expect(modelTeam(pick({ ...final, model_correct: true }))).toBe("GSW");
    expect(modelTeam(pick({ ...final, model_correct: false }))).toBe("LAL");
    expect(modelTeam(pick({ ...final, model_correct: null }))).toBeNull();
  });

  it("limits last 7 days to the week before today", () => {
    const inside = pick({ game_date: "2026-10-23" });
    const outside = pick({ game_date: "2026-10-22" });
    expect(filterSettled([inside, outside], { ...filters, range: "week" }, "2026-10-30")).toEqual([
      inside,
    ]);
  });

  it("keeps one split per group and takes a chosen split back off", () => {
    expect(toggleSplit(["favorite", "home"], "underdog")).toEqual(["home", "underdog"]);
    expect(toggleSplit(["favorite"], "favorite")).toEqual([]);
    expect(splitLabel("with-model")).toBe("With the model");
  });

  it("filters by the side taken against the model", () => {
    const final = { home_score: 2, away_score: 1 };
    const withModel = pick({ ...final, model_correct: true });
    const against = pick({ ...final, model_correct: false });
    const uncalled = pick(final);
    const picks = [withModel, against, uncalled];
    expect(filterSettled(picks, { ...filters, splits: ["with-model"] })).toEqual([withModel]);
    expect(filterSettled(picks, { ...filters, splits: ["against-model"] })).toEqual([against]);
  });

  it("counts tonight apart from later, and names the first lock", () => {
    const tonight = pick({ game_date: "2026-10-30", start_time_et: "19:30:00" });
    const early = pick({ game_date: "2026-10-30", start_time_et: "16:00:00" });
    const later = pick({ game_date: "2026-11-02", start_time_et: "19:30:00" });
    expect(openSummary([tonight, early, later], null, now)).toBe(
      "2 tonight · 1 later · first lock 4:00 PM"
    );
    expect(openSummary([later], null, now)).toBe("1 open · first lock Nov 2, 7:30 PM");
    expect(openSummary([pick({ game_date: "2026-10-30", start_time_et: null })], null, now)).toBe(
      "1 awaiting final"
    );
    expect(openSummary([pick({ game_date: "2026-11-02", start_time_et: null })], null, now)).toBe(
      "1 open"
    );
  });
});

describe("pickDays", () => {
  it("groups picks by date and marks finished game days without one as missed", () => {
    const days = pickDays(
      [
        pick({ game_id: "a", game_date: "2026-11-03", result: "won", stake: 10, profit: 9.09 }),
        pick({ game_id: "b", game_date: "2026-11-03", result: "lost" }),
        pick({ game_id: "c", game_date: "2026-11-05", result: "pending" }),
      ],
      ["2026-11-01", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
      "2026-11-05"
    );
    expect(days.get("2026-11-03")).toMatchObject({ wins: 1, losses: 1, net: 9.09, staked: true });
    expect(days.get("2026-11-04")).toMatchObject({ missed: true, picked: 0 });
    expect(days.get("2026-11-05")).toMatchObject({ open: 1, missed: false });
    // Before the first pick, and from today on, nothing is missed yet.
    expect(days.has("2026-11-01")).toBe(false);
    expect(days.has("2026-11-06")).toBe(false);

    expect(monthPickSummary(days.values(), "2026-11")).toEqual({
      wins: 1,
      losses: 1,
      net: 9.09,
      staked: true,
      picked: 2,
      missed: 1,
    });
  });

  it("marks nothing missed before the first pick", () => {
    expect(pickDays([], ["2026-11-01"], "2026-11-05").size).toBe(0);
  });
});
