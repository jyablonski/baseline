import type { ModelGame, ModelReview, ModelScorecardRow, RegisteredModel } from "@/lib/admin";
import type { Level } from "@/lib/admin-status";
import { MODEL_NOTES, modelLabel } from "@/lib/predictions";

export const MODEL_REMINDER_COOKIE = "baseline_model_reminder";

/** Shared games before a shadow's lead is worth acting on. */
export const PROMOTION_GAMES = 150;

/** Log-loss points per sparkline, and the games each one averages. */
const WINDOW = 30;
/** How much of the prediction log reaches the browser. */
const LOG_ROWS = 200;

const CLIP = 1e-6;
const CALIBRATION_EDGES = [0, 0.4, 0.5, 0.6, 0.7, 1.0001];

/** The log loss of one call. Clipped like the scorecard, so they agree. */
export function gameLogLoss(homeWp: number, homeWon: boolean) {
  const wp = Math.min(Math.max(homeWp, CLIP), 1 - CLIP);
  return -Math.log(homeWon ? wp : 1 - wp);
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Rolling mean log loss, oldest first. Under a full window it averages what there is. */
export function rollingLogLoss(losses: number[]) {
  const points = losses.map((_, end) => mean(losses.slice(Math.max(0, end - WINDOW + 1), end + 1)));
  return points.slice(-WINDOW);
}

export type CalibrationPoint = { predicted: number; actual: number; n: number };

/** Predicted vs actual by bucket, the same buckets as the public page. */
export function calibrationPoints(games: ModelGame[], modelVersion: string): CalibrationPoint[] {
  const calls = games.filter((game) => game.predictions[modelVersion] != null);
  return CALIBRATION_EDGES.slice(1).flatMap((upper, index) => {
    const lower = CALIBRATION_EDGES[index];
    const inBucket = calls.filter((game) => {
      const wp = game.predictions[modelVersion];
      return wp >= lower && wp < upper;
    });
    if (inBucket.length === 0) return [];
    return [
      {
        predicted: mean(inBucket.map((game) => game.predictions[modelVersion])),
        actual: inBucket.filter((game) => game.home_won).length / inBucket.length,
        n: inBucket.length,
      },
    ];
  });
}

export type SharedGap = {
  n: number;
  live: number;
  shadow: number;
  /** 95% half-width of the paired difference in log loss. */
  noise: number;
};

/** Two models over the games both predicted, which is the only fair comparison. */
export function sharedGap(games: ModelGame[], live: string, shadow: string): SharedGap | null {
  const shared = games.filter(
    (game) => game.predictions[live] != null && game.predictions[shadow] != null
  );
  if (shared.length < 2) return null;
  const liveLosses = shared.map((game) => gameLogLoss(game.predictions[live], game.home_won));
  const shadowLosses = shared.map((game) => gameLogLoss(game.predictions[shadow], game.home_won));
  const gaps = liveLosses.map((loss, index) => loss - shadowLosses[index]);
  const average = mean(gaps);
  const variance = gaps.reduce((sum, gap) => sum + (gap - average) ** 2, 0) / (gaps.length - 1);
  return {
    n: shared.length,
    live: mean(liveLosses),
    shadow: mean(shadowLosses),
    noise: 1.96 * Math.sqrt(variance / gaps.length),
  };
}

export type ReviewedModel = {
  row: ModelScorecardRow;
  label: string;
  note: string | null;
  live: boolean;
  /** Oldest first; empty for a model with no graded games. */
  sparkline: number[];
  calibration: CalibrationPoint[];
};

export type ShadowLead = SharedGap & {
  modelVersion: string;
  label: string;
  liveLabel: string;
  betterCalibrated: boolean;
  /** The gap is wider than normal noise at this sample size. */
  clear: boolean;
  /** At the sample size where a lead is worth acting on, or clearly past noise. */
  ready: boolean;
};

export type LogRow = {
  gameId: string;
  date: string;
  matchup: string;
  winner: string | null;
  homeWon: boolean;
  calls: Record<string, number>;
  marketWp: number | null;
  /** Not every call took the same side. */
  disagree: boolean;
};

export type ModelReviewView = {
  season: string | null;
  live: ReviewedModel | null;
  liveSince: string | null;
  bestShadow: ReviewedModel | null;
  lead: ShadowLead | null;
  /** The serving model's label while gold still shows the old one. */
  staleServing: string | null;
  models: ReviewedModel[];
  marketSparkline: number[];
  logColumns: { version: string; label: string }[];
  log: LogRow[];
  /** "Elo v2 started 3 games late…", when a model has fewer games than the live one. */
  lateNote: string | null;
};

function byLiveFirst(a: ReviewedModel, b: ReviewedModel) {
  if (a.live !== b.live) return a.live ? -1 : 1;
  return (a.row.logloss ?? Infinity) - (b.row.logloss ?? Infinity);
}

function modelLogLosses(games: ModelGame[], version: string) {
  // Games arrive newest first; a rolling line reads oldest first.
  return games
    .filter((game) => game.predictions[version] != null)
    .map((game) => gameLogLoss(game.predictions[version], game.home_won))
    .reverse();
}

function logRow(game: ModelGame, versions: string[]): LogRow {
  const sides = [
    ...versions.flatMap((version) =>
      game.predictions[version] == null ? [] : [game.predictions[version] >= 0.5]
    ),
    ...(game.market_wp == null ? [] : [game.market_wp >= 0.5]),
  ];
  return {
    gameId: game.game_id,
    date: game.game_date,
    matchup: `${game.home_team_abbreviation ?? "—"} vs ${game.away_team_abbreviation ?? "—"}`,
    winner: game.home_won ? game.home_team_abbreviation : game.away_team_abbreviation,
    homeWon: game.home_won,
    calls: game.predictions,
    marketWp: game.market_wp,
    disagree: new Set(sides).size > 1,
  };
}

/** Everything the Models tab draws, worked out on the server. */
export function buildModelReview(review: ModelReview): ModelReviewView {
  const { games } = review;
  const registered = new Map<string, RegisteredModel>(
    review.models.map((model) => [model.model_version, model])
  );
  const models = review.rows
    .map((row) => ({
      row,
      label: modelLabel(row),
      note: MODEL_NOTES[row.model_version] ?? null,
      live: row.model_version === review.live_model_version,
      sparkline: rollingLogLoss(modelLogLosses(games, row.model_version)),
      calibration: calibrationPoints(games, row.model_version),
    }))
    .sort(byLiveFirst);

  const live = models.find((model) => model.live) ?? null;
  const shadows = models.filter((model) => !model.live);
  const bestShadow =
    shadows.toSorted((a, b) => (a.row.logloss ?? Infinity) - (b.row.logloss ?? Infinity))[0] ??
    null;

  let lead: ShadowLead | null = null;
  if (live && bestShadow) {
    const gap = sharedGap(games, live.row.model_version, bestShadow.row.model_version);
    if (gap && gap.shadow < gap.live) {
      lead = {
        ...gap,
        modelVersion: bestShadow.row.model_version,
        label: bestShadow.label,
        liveLabel: live.label,
        betterCalibrated:
          (bestShadow.row.calibration_error ?? Infinity) < (live.row.calibration_error ?? Infinity),
        clear: gap.live - gap.shadow > gap.noise,
        ready: gap.n >= PROMOTION_GAMES || gap.live - gap.shadow > gap.noise,
      };
    }
  }

  const late = live ? shadows.filter((model) => model.row.n < live.row.n) : [];
  const serving = review.serving_model_version;
  const servingRow = review.rows.find((row) => row.model_version === serving);

  const logColumns = models.map((model) => ({
    version: model.row.model_version,
    // Two families share version numbers, so the bare "V1" would be ambiguous.
    label: model.row.model_version.toUpperCase(),
  }));
  const versions = logColumns.map((column) => column.version);

  return {
    season: review.season,
    live,
    liveSince: live ? (registered.get(live.row.model_version)?.promoted_at ?? null) : null,
    bestShadow,
    lead,
    staleServing:
      serving && serving !== review.live_model_version
        ? servingRow
          ? modelLabel(servingRow)
          : serving
        : null,
    models,
    marketSparkline: rollingLogLoss(
      games
        .filter((game) => game.market_wp != null)
        .map((game) => gameLogLoss(game.market_wp as number, game.home_won))
        .reverse()
    ),
    logColumns,
    log: games.slice(0, LOG_ROWS).map((game) => logRow(game, versions)),
    lateNote:
      late.length > 0 && live
        ? late
            .map(
              (model) =>
                `${model.label} started ${live.row.n - model.row.n} games late, so compare it on the ${model.row.n} shared games.`
            )
            .join(" ")
        : null,
  };
}

/** The Models entry for the review list, unless the operator has asked to wait. */
export function modelReviewItem(view: ModelReviewView, remindedFor: string | undefined) {
  const { lead } = view;
  if (!lead) return null;
  if (!lead.ready && remindedFor === lead.modelVersion) return null;
  const level: Level = "warn";
  return {
    key: "model-shadow-ahead",
    level,
    title: `${lead.label} is ahead of live`,
    detail: `${lead.shadow.toFixed(3)} vs ${lead.live.toFixed(3)} log loss over ${lead.n} shared games.${
      lead.clear ? "" : " Still inside normal noise."
    }`,
    tab: "models" as const,
  };
}
