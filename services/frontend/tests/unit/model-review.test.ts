import { describe, expect, it } from "vitest";

import type { ModelGame, ModelReview, ModelScorecardRow } from "@/lib/admin";
import {
  buildModelReview,
  calibrationPoints,
  gameLogLoss,
  modelReviewItem,
  PROMOTION_GAMES,
  rollingLogLoss,
  sharedGap,
} from "@/lib/model-review";
import { latestSeason, marketComparison, modelCall, usesInjuries } from "@/lib/predictions";
import type { PredictionGame, ScorecardRow } from "@/lib/types";

function game(index: number, predictions: Record<string, number>, homeWon = true): ModelGame {
  return {
    game_id: `g-${index}`,
    game_date: `2026-10-${String(29 - (index % 20)).padStart(2, "0")}`,
    home_team_abbreviation: "POR",
    away_team_abbreviation: "MEM",
    home_won: homeWon,
    market_wp: 0.6,
    predictions,
  };
}

function row(overrides: Partial<ModelScorecardRow> = {}): ModelScorecardRow {
  return {
    season: "2026-27",
    model_name: "elo",
    model_version: "elo-v1",
    is_champion: false,
    n: 10,
    logloss: 0.62,
    brier: 0.2,
    accuracy: 0.6,
    home_always_accuracy: 0.5,
    calibration_error: 0.1,
    market_n: 10,
    market_logloss: 0.58,
    market_brier: 0.19,
    ...overrides,
  };
}

function review(overrides: Partial<ModelReview> = {}): ModelReview {
  return {
    season: "2026-27",
    live_model_version: "elo-v1",
    serving_model_version: "elo-v1",
    models: [
      {
        model_version: "elo-v1",
        model_name: "elo",
        is_champion: true,
        promoted_at: "2026-10-20T12:00:00Z",
        promoted_by: "jacob",
      },
    ],
    rows: [
      row({ is_champion: true }),
      row({ model_version: "elo-v2", logloss: 0.6, n: 8, calibration_error: 0.12 }),
    ],
    games: [],
    ...overrides,
  };
}

describe("model review maths", () => {
  it("clips a certain call the way the scorecard does", () => {
    expect(gameLogLoss(1, false)).toBeCloseTo(13.8155, 3);
    expect(gameLogLoss(0.5, true)).toBeCloseTo(0.6931, 3);
  });

  it("rolls over the last 30 games and starts with what there is", () => {
    expect(rollingLogLoss([1, 3])).toEqual([1, 2]);
    const line = rollingLogLoss(Array.from({ length: 40 }, () => 2));
    expect(line).toHaveLength(30);
  });

  it("buckets a model's calls and skips empty buckets and missed games", () => {
    const games = [
      game(1, { a: 0.65 }),
      game(2, { a: 0.62 }, false),
      game(3, { a: 0.2 }, false),
      game(4, { b: 0.5 }),
    ];
    expect(calibrationPoints(games, "a")).toEqual([
      { predicted: 0.2, actual: 0, n: 1 },
      { predicted: 0.635, actual: 0.5, n: 2 },
    ]);
  });

  it("compares two models only on the games both predicted", () => {
    const games = [game(1, { a: 0.6, b: 0.7 }), game(2, { a: 0.6, b: 0.8 }), game(3, { a: 0.1 })];
    const gap = sharedGap(games, "a", "b");
    expect(gap?.n).toBe(2);
    expect(gap?.live).toBeCloseTo(gameLogLoss(0.6, true));
    expect(gap?.shadow).toBeLessThan(gap?.live ?? 0);
    expect(sharedGap(games.slice(2), "a", "b")).toBeNull();
  });
});

describe("buildModelReview", () => {
  it("puts the live model first, and names the best shadow", () => {
    const view = buildModelReview(review());
    expect(view.models.map((model) => model.row.model_version)).toEqual(["elo-v1", "elo-v2"]);
    expect(view.live?.note).toBe("Adds margin of victory and a learned home edge");
    expect(view.bestShadow?.label).toBe("Elo v2");
    expect(view.liveSince).toBe("2026-10-20T12:00:00Z");
    expect(view.lateNote).toBe("Elo v2 started 2 games late, so compare it on the 8 shared games.");
  });

  it("flags a shadow ahead on the shared games, and says if calibration agrees", () => {
    const games = Array.from({ length: 20 }, (_, index) =>
      game(index, { "elo-v1": 0.55, "elo-v2": index % 2 ? 0.6 : 0.56 })
    );
    const { lead } = buildModelReview(review({ games }));
    expect(lead?.modelVersion).toBe("elo-v2");
    expect(lead?.n).toBe(20);
    expect(lead?.betterCalibrated).toBe(false);
  });

  it("calls a lead ready only past noise or at the promotion sample", () => {
    const noisy = Array.from({ length: 40 }, (_, index) =>
      game(index, { "elo-v1": 0.55, "elo-v2": index % 2 ? 0.9 : 0.3 }, index % 2 === 1)
    );
    expect(buildModelReview(review({ games: noisy })).lead?.ready).toBe(true);
    const mixed = Array.from({ length: 40 }, (_, index) =>
      game(index, { "elo-v1": 0.55, "elo-v2": index % 4 === 0 ? 0.3 : 0.7 }, index % 8 !== 0)
    );
    const lead = buildModelReview(review({ games: mixed })).lead;
    expect(lead === null || lead.n < PROMOTION_GAMES).toBe(true);
  });

  it("says nothing when the live model leads", () => {
    const games = Array.from({ length: 5 }, (_, index) =>
      game(index, { "elo-v1": 0.8, "elo-v2": 0.6 })
    );
    expect(buildModelReview(review({ games })).lead).toBeNull();
  });

  it("marks disagreements and keeps the live model's column first", () => {
    const view = buildModelReview(
      review({
        games: [game(1, { "elo-v1": 0.6, "elo-v2": 0.4 }), game(2, { "elo-v1": 0.6 })],
      })
    );
    expect(view.logColumns.map((column) => column.label)).toEqual(["ELO-V1", "ELO-V2"]);
    expect(view.log.map((line) => line.disagree)).toEqual([true, false]);
    expect(view.log[0].matchup).toBe("POR vs MEM");
    expect(view.log[0].winner).toBe("POR");
  });

  it("reports when gold has yet to catch up with a promotion", () => {
    const view = buildModelReview(review({ live_model_version: "elo-v2" }));
    expect(view.staleServing).toBe("Elo v1");
    expect(buildModelReview(review()).staleServing).toBeNull();
    expect(buildModelReview(review({ serving_model_version: null })).staleServing).toBeNull();
  });

  it("survives a season with nothing graded", () => {
    const view = buildModelReview(review({ rows: [], live_model_version: null }));
    expect(view.live).toBeNull();
    expect(view.bestShadow).toBeNull();
    expect(view.models).toEqual([]);
  });
});

describe("modelReviewItem", () => {
  const games = Array.from({ length: 30 }, (_, index) =>
    game(index, { "elo-v1": 0.55, "elo-v2": index % 3 ? 0.7 : 0.5 }, index % 3 !== 0)
  );

  it("raises one warning for the Models tab", () => {
    const item = modelReviewItem(buildModelReview(review({ games })), undefined);
    expect(item).toMatchObject({ tab: "models", level: "warn", title: "Elo v2 is ahead of live" });
  });

  it("stays quiet after Remind me, until the sample is there", () => {
    const view = buildModelReview(review({ games }));
    const waiting = { ...view, lead: { ...view.lead!, ready: false } };
    expect(modelReviewItem(waiting, "elo-v2")).toBeNull();
    expect(modelReviewItem(waiting, "elo-v9")).not.toBeNull();
    expect(modelReviewItem({ ...view, lead: { ...view.lead!, ready: true } }, "elo-v2")).not.toBe(
      null
    );
  });

  it("says when a lead is still inside noise", () => {
    const view = buildModelReview(review({ games }));
    const lead = { ...view.lead!, ready: true };
    expect(
      modelReviewItem({ ...view, lead: { ...lead, clear: false } }, undefined)?.detail
    ).toContain("Still inside normal noise.");
    expect(
      modelReviewItem({ ...view, lead: { ...lead, clear: true } }, undefined)?.detail
    ).not.toContain("noise");
  });

  it("has nothing to say without a lead", () => {
    expect(modelReviewItem(buildModelReview(review()), undefined)).toBeNull();
  });
});

describe("prediction copy", () => {
  const scorecard = (logloss: number | null, market: number | null) =>
    ({ logloss, market_logloss: market }) as ScorecardRow;

  it("puts the sportsbook gap in words", () => {
    expect(marketComparison(scorecard(0.62, 0.6)).title).toBe("Slightly behind");
    expect(marketComparison(scorecard(0.67, 0.6)).title).toBe("Behind");
    expect(marketComparison(scorecard(0.6, 0.602)).title).toBe("About even");
    expect(marketComparison(scorecard(0.59, 0.6)).title).toBe("Slightly ahead");
    expect(marketComparison(scorecard(0.55, 0.6)).title).toBe("Ahead");
    expect(marketComparison(scorecard(0.6, null)).title).toBe("—");
  });

  it("reads a call from the favourite's side", () => {
    const call = modelCall({
      home_team_abbreviation: "POR",
      away_team_abbreviation: "MEM",
      model_wp: 0.38,
      home_won: true,
    } as PredictionGame);
    expect(call).toMatchObject({ team: "MEM", opponent: "POR", winner: "POR", correct: false });
    expect(call.chance).toBeCloseTo(0.62);
  });

  it("knows which models read the injury report", () => {
    expect(usesInjuries("elo-v2")).toBe(true);
    expect(usesInjuries("elo-v1")).toBe(false);
    expect(usesInjuries(null)).toBe(false);
  });

  it("keeps the newest season", () => {
    expect(latestSeason([{ season: "2025-26" }, { season: "2026-27" }])).toEqual([
      { season: "2026-27" },
    ]);
  });
});
