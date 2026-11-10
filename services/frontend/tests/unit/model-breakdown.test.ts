import { describe, expect, it } from "vitest";

import {
  breakdownView,
  lineText,
  marketLineText,
  roundHalf,
  roundParts,
  weightLines,
} from "@/lib/model-breakdown";
import type { GameDetail, PredictionBreakdown } from "@/lib/types";

const GAME = {
  home_team_abbreviation: "DAL",
  away_team_abbreviation: "IND",
  home_is_back_to_back: false,
  away_is_back_to_back: true,
  home_spread: -4.5,
} as GameDetail;

const V1_SETTINGS = { home_court_points: 1.3, home_games: 154, home_win_rate: 0.52 };

function breakdown(
  parts: PredictionBreakdown["parts"],
  settings: PredictionBreakdown["settings"] = V1_SETTINGS
): PredictionBreakdown {
  return { points_per_logit: 8, parts, settings };
}

describe("roundHalf", () => {
  it("rounds to sportsbook half points on either side", () => {
    expect(roundHalf(4.74)).toBe(4.5);
    expect(roundHalf(4.76)).toBe(5);
    expect(roundHalf(-1.3)).toBe(-1.5);
    expect(roundHalf(0.2)).toBe(0);
  });
});

describe("roundParts", () => {
  it("adds up to the total rounded once, not to each part rounded alone", () => {
    // Alone: 0 + 0 + 0 = 0, though the total is 0.6, which rounds to 0.5.
    expect(roundParts([0.2, 0.2, 0.2])).toEqual([0.5, 0, 0]);
    // Alone: -0.5 + 1.5 = 1, against a true 0.7. Home court lost more to rounding.
    expect(roundParts([-0.6, 1.3])).toEqual([-0.5, 1]);
    expect(roundParts([5.1, 1.3])).toEqual([5, 1.5]);
  });
});

describe("breakdownView", () => {
  it("credits each part to the team it favours and adds them into the line", () => {
    const view = breakdownView(
      breakdown([
        { key: "strength", points: 5.1 },
        { key: "home_court", points: 1.3 },
      ]),
      GAME
    );
    expect(view.rows.map((row) => [row.label, row.team, row.points])).toEqual([
      ["Team strength", "DAL", 5],
      ["Home court", "DAL", 1.5],
    ]);
    expect(view.rows[1].detail).toBe("Home teams have won 52% of the 154 games it has seen");
    expect(lineText(view)).toBe("DAL by 6.5");
  });

  it("shows the layer's parts only on games they moved", () => {
    const view = breakdownView(
      breakdown([
        { key: "strength", points: -3 },
        { key: "home_court", points: 1.3 },
        { key: "confidence", points: 0.1 },
        { key: "back_to_back", points: 1.6 },
        { key: "injuries", points: -2.4 },
      ]),
      GAME
    );
    expect(view.rows.map((row) => row.key)).toEqual([
      "strength",
      "home_court",
      "back_to_back",
      "injuries",
    ]);
    const byKey = Object.fromEntries(view.rows.map((row) => [row.key, row]));
    expect(byKey.strength.team).toBe("IND");
    expect(byKey.back_to_back).toMatchObject({ team: "DAL", detail: "IND played last night" });
    expect(byKey.injuries).toMatchObject({ team: "IND", points: 2.5 });
    // -3 + 1.5 + 1.5 - 2.5
    expect(lineText(view)).toBe("IND by 2.5");
  });

  it("calls a game the parts cancel out a pick'em and a zero part even", () => {
    const view = breakdownView(
      breakdown(
        [
          { key: "strength", points: 0.1 },
          { key: "home_court", points: 4.6 },
          { key: "confidence", points: -4.6 },
        ],
        { home_court_points: 4.6, confidence: 0.5 }
      ),
      GAME
    );
    expect(view.rows[0].team).toBeNull();
    expect(view.rows[1].detail).toBe("A fixed edge for the home team");
    expect(view.rows[2]).toMatchObject({
      team: "IND",
      detail: "Its confident calls have been missing, so it hedges toward the underdog",
    });
    expect(lineText(view)).toBe("Pick'em");
  });
});

describe("marketLineText", () => {
  it("says the sportsbook's spread the way the model's line reads", () => {
    expect(marketLineText(GAME)).toBe("DAL by 4.5");
    expect(marketLineText({ ...GAME, home_spread: 3 })).toBe("IND by 3");
    expect(marketLineText({ ...GAME, home_spread: 0 })).toBe("Pick'em");
    expect(marketLineText({ ...GAME, home_spread: null })).toBeNull();
  });
});

describe("weightLines", () => {
  it("lists strength, home court and the blind spots for a model without the layer", () => {
    const lines = weightLines({
      model_version: "elo-v1",
      as_of: "2026-11-10T08:00:00",
      settings: V1_SETTINGS,
    });
    expect(lines.map((line) => [line.label, line.value])).toEqual([
      ["Team strength", "From results"],
      ["Home court", "Worth 1.5 points"],
      ["Not included", "Injuries, rest, trades"],
    ]);
    expect(lines[0].detail).toBe("Every win and loss so far, and by how much");
  });

  it("says Elo v0 ignores margins and has a fixed home edge", () => {
    const lines = weightLines({
      model_version: "elo-v0",
      as_of: "2026-11-10T08:00:00",
      settings: { home_court_points: 1.0 },
    });
    expect(lines[0].detail).toBe("Every win and loss so far");
    expect(lines[1]).toMatchObject({
      value: "Worth 1 point",
      detail: "A fixed edge for the home team",
    });
  });

  it("puts the layer's learned weights into words", () => {
    const settings = {
      ...V1_SETTINGS,
      confidence: 0.9,
      back_to_back_points: -1.6,
      injury_points: -2.2,
      injury_unit: "notable_player" as const,
    };
    const lines = weightLines({ model_version: "elo-v2", as_of: "2026-11-10", settings });
    expect(lines.map((line) => [line.label, line.value])).toEqual([
      ["Team strength", "From results"],
      ["Home court", "Worth 1.5 points"],
      ["Confidence", "Toned down 10%"],
      ["Back-to-back", "Costs 1.5 points"],
      ["Injuries", "Costs 2 points a player"],
      ["Not included", "Trades, late scratches"],
    ]);

    const v3 = weightLines({
      model_version: "elo-v3",
      as_of: "2026-11-10",
      settings: {
        ...settings,
        confidence: 1.08,
        back_to_back_points: 0.4,
        injury_unit: "injury_score",
      },
    });
    const v3Values = Object.fromEntries(v3.map((line) => [line.label, line.value]));
    expect(v3Values).toMatchObject({
      Confidence: "Turned up 8%",
      "Back-to-back": "No cost found yet",
      Injuries: "Weighed by production",
    });

    const unchanged = weightLines({
      model_version: "elo-v2",
      as_of: "2026-11-10",
      settings: { ...settings, confidence: 1, injury_points: 0.1 },
    });
    expect(unchanged.find((line) => line.label === "Confidence")?.value).toBe("Unchanged");
    expect(unchanged.find((line) => line.label === "Injuries")?.value).toBe("No cost found yet");
  });
});
