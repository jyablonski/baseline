import { formatProbability } from "@/lib/format";
import type {
  BreakdownKey,
  GameDetail,
  LiveModelWeights,
  ModelSettings,
  PredictionBreakdown,
} from "@/lib/types";

/** Sportsbook-style half points, so a line reads like one. */
export function roundHalf(points: number) {
  const rounded = Math.round(Math.abs(points) * 2) / 2;
  return points < 0 ? -rounded : rounded;
}

function pointsText(points: number) {
  const value = Math.abs(points);
  return `${value} ${value === 1 ? "point" : "points"}`;
}

export type BreakdownRow = {
  key: BreakdownKey;
  label: string;
  detail: string | null;
  /** The team this part favours; null when it rounds to nothing. */
  team: string | null;
  /** Half points, always positive: the size of the push toward `team`. */
  points: number;
};

export type BreakdownView = {
  rows: BreakdownRow[];
  /** The model's line: the favourite and by how much, or null for a pick'em. */
  favourite: string | null;
  margin: number;
};

const LABELS: Record<BreakdownKey, string> = {
  strength: "Team strength",
  home_court: "Home court",
  confidence: "Confidence",
  back_to_back: "Back-to-back",
  injuries: "Injuries",
};

// Always shown, so a game reads the same whether or not it is close; the
// layer's parts only appear on a game they actually moved.
const ALWAYS_SHOWN: BreakdownKey[] = ["strength", "home_court"];

function homeCourtDetail(settings: ModelSettings) {
  if (settings.home_win_rate == null || !settings.home_games)
    return "A fixed edge for the home team";
  return `Home teams have won ${formatProbability(settings.home_win_rate)} of the ${settings.home_games} games it has seen`;
}

function backToBackDetail(game: GameDetail) {
  const tired = [
    game.away_is_back_to_back ? game.away_team_abbreviation : null,
    game.home_is_back_to_back ? game.home_team_abbreviation : null,
  ].filter(Boolean);
  if (tired.length === 0) return null;
  return `${tired.join(" and ")} played last night`;
}

function detailFor(
  key: BreakdownKey,
  breakdown: PredictionBreakdown,
  game: GameDetail
): string | null {
  switch (key) {
    case "strength":
      return "Ratings built from past results";
    case "home_court":
      return homeCourtDetail(breakdown.settings);
    case "confidence":
      // (a - 1) * logit: pulling toward 50% always pushes toward the underdog.
      return (breakdown.settings.confidence ?? 1) < 1
        ? "Its confident calls have been missing, so it hedges toward the underdog"
        : "Its confident calls have been landing, so it leans further in";
    case "back_to_back":
      return backToBackDetail(game);
    case "injuries":
      return "Players ruled out on the morning report";
  }
}

/**
 * Half points that add up to the total rounded once. Rounding each part on its
 * own can drift by up to a quarter point per part, enough to print a line for
 * the team the win % has as the underdog; the missing half points go to the
 * parts that rounding cost the most.
 */
export function roundParts(values: number[]) {
  const rounded = values.map(roundHalf);
  const target = roundHalf(values.reduce((sum, value) => sum + value, 0));
  let steps = Math.round((target - rounded.reduce((sum, value) => sum + value, 0)) * 2);
  const direction = Math.sign(steps);
  const byShortfall = values
    .map((_, index) => index)
    .sort(
      (left, right) =>
        (values[right] - rounded[right]) * direction - (values[left] - rounded[left]) * direction
    );
  for (const index of byShortfall) {
    if (steps === 0) break;
    rounded[index] += 0.5 * direction;
    steps -= direction;
  }
  return rounded;
}

/**
 * The parts in half points, each credited to the team it favours, and the line
 * they add up to, so the rows always add up to what is printed under them.
 */
export function breakdownView(breakdown: PredictionBreakdown, game: GameDetail): BreakdownView {
  const home = game.home_team_abbreviation ?? "Home";
  const away = game.away_team_abbreviation ?? "Away";
  const rounded = roundParts(breakdown.parts.map((part) => part.points));
  const rows: BreakdownRow[] = [];
  let line = 0;
  for (const [index, part] of breakdown.parts.entries()) {
    const points = rounded[index];
    if (points === 0 && !ALWAYS_SHOWN.includes(part.key)) continue;
    line += points;
    rows.push({
      key: part.key,
      label: LABELS[part.key] ?? part.key,
      detail: detailFor(part.key, breakdown, game) ?? null,
      team: points === 0 ? null : points > 0 ? home : away,
      points: Math.abs(points),
    });
  }
  return {
    rows,
    favourite: line === 0 ? null : line > 0 ? home : away,
    margin: Math.abs(line),
  };
}

/** "DAL by 6", or "Pick'em". */
export function lineText(view: Pick<BreakdownView, "favourite" | "margin">) {
  return view.favourite == null ? "Pick'em" : `${view.favourite} by ${view.margin}`;
}

/** The sportsbook's spread, said the same way as the model's line. */
export function marketLineText(game: GameDetail) {
  if (game.home_spread == null) return null;
  const margin = Math.abs(game.home_spread);
  if (margin === 0) return "Pick'em";
  const favourite =
    game.home_spread < 0 ? game.home_team_abbreviation : game.away_team_abbreviation;
  return `${favourite} by ${margin}`;
}

export type WeightLine = { label: string; value: string; detail: string };

// Elo v0 counts wins only; every later Elo also weighs the margin.
const RESULT_INPUTS: Record<string, string> = {
  "elo-v0": "Every win and loss so far",
};

/**
 * What the live model weighs on its newest run, in words. Lines appear only
 * for parts the model has, so a model without the layer lists two and the
 * blind spots.
 */
export function weightLines({ model_version, settings }: LiveModelWeights): WeightLine[] {
  const lines: WeightLine[] = [
    {
      label: "Team strength",
      value: "From results",
      detail: RESULT_INPUTS[model_version] ?? "Every win and loss so far, and by how much",
    },
    {
      label: "Home court",
      value: `Worth ${pointsText(roundHalf(settings.home_court_points))}`,
      detail: homeCourtDetail(settings),
    },
  ];
  const layered = settings.confidence != null;
  if (layered) {
    const shift = Math.round(Math.abs(1 - (settings.confidence ?? 1)) * 100);
    lines.push({
      label: "Confidence",
      value:
        shift === 0
          ? "Unchanged"
          : (settings.confidence ?? 1) < 1
            ? `Toned down ${shift}%`
            : `Turned up ${shift}%`,
      detail: "Re-learned each day from how its confident calls have done",
    });
    const backToBack = roundHalf(-(settings.back_to_back_points ?? 0));
    lines.push({
      label: "Back-to-back",
      value: backToBack > 0 ? `Costs ${pointsText(backToBack)}` : "No cost found yet",
      detail: "Learned from this season's back-to-backs",
    });
    const injury = roundHalf(-(settings.injury_points ?? 0));
    lines.push(
      settings.injury_unit === "injury_score"
        ? {
            label: "Injuries",
            value: injury > 0 ? "Weighed by production" : "No cost found yet",
            detail: "Players ruled out count by how much they have been producing",
          }
        : {
            label: "Injuries",
            value: injury > 0 ? `Costs ${pointsText(injury)} a player` : "No cost found yet",
            detail: "Each notable player ruled out on the morning report",
          }
    );
  }
  lines.push({
    label: "Not included",
    value: layered ? "Trades, late scratches" : "Injuries, rest, trades",
    detail: layered
      ? "Anything after the morning report, until it shows up in results"
      : "Until they show up in results",
  });
  return lines;
}
