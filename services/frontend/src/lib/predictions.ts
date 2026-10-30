import type { PredictionGame, ScorecardRow } from "@/lib/types";

const MODEL_LABELS: Record<string, string> = {
  elo: "Elo",
  logit: "Logistic regression",
};

// Two versions of one model can grade side by side (elo-v0 / elo-v1), so the
// name alone is ambiguous. "elo-v1" -> "Elo v1".
export function modelLabel(row: Pick<ScorecardRow, "model_name" | "model_version">): string {
  const name = MODEL_LABELS[row.model_name] ?? row.model_name;
  const version = row.model_version.split("-").at(-1);
  return version && version !== row.model_version ? `${name} ${version}` : name;
}

/** What sets each model apart, in a few words. */
export const MODEL_NOTES: Record<string, string> = {
  "elo-v0": "Rating that moves after every result",
  "elo-v1": "Adds margin of victory and a learned home edge",
  "elo-v2": "Elo v1 plus back-to-backs and notable injuries",
  "logit-v1": "Eleven pregame stats: form, rest, travel and more",
};

/** The only model that reads the injury report. */
export function usesInjuries(modelVersion: string | null | undefined) {
  return modelVersion === "elo-v2";
}

/** A scorecard's newest season: every row carries its season. */
export function latestSeason<Row extends { season: string }>(rows: Row[]) {
  const season = rows.reduce<string | null>(
    (latest, row) => (latest == null || row.season > latest ? row.season : latest),
    null
  );
  return rows.filter((row) => row.season === season);
}

/** How the model's log loss sits against the sportsbook's. Lower is better. */
export function marketComparison(row: ScorecardRow) {
  if (row.logloss == null || row.market_logloss == null) {
    return { title: "—", note: "no odds on file yet" };
  }
  const gap = row.logloss - row.market_logloss;
  if (Math.abs(gap) < 0.005) {
    return { title: "About even", note: "The model and the market's odds were about as sharp" };
  }
  if (gap > 0.03) {
    return {
      title: "Behind",
      note: "The market's odds were sharper, as expected for a simple model",
    };
  }
  if (gap > 0) {
    return {
      title: "Slightly behind",
      note: "The market's odds were a bit sharper, as expected for a simple model",
    };
  }
  return {
    title: gap < -0.03 ? "Ahead" : "Slightly ahead",
    note: "The model was sharper than the market's odds",
  };
}

/** The model's favourite in a graded game, from that side. */
export function modelCall(game: PredictionGame) {
  const homeFavored = game.model_wp >= 0.5;
  const team = homeFavored ? game.home_team_abbreviation : game.away_team_abbreviation;
  const opponent = homeFavored ? game.away_team_abbreviation : game.home_team_abbreviation;
  return {
    team,
    opponent,
    chance: homeFavored ? game.model_wp : 1 - game.model_wp,
    winner: game.home_won ? game.home_team_abbreviation : game.away_team_abbreviation,
    correct: homeFavored === game.home_won,
  };
}
