import type { PlayerValue } from "@/lib/types";

export type ValueCategory = "mvp" | "undervalued" | "overpaid" | "fair";

export type PlayerValuePoint = PlayerValue & {
  salary_millions: number;
  /** Share of plotted players this one outscores, 0-1. */
  score_percentile: number;
  /** Share of plotted players this one out-earns, 0-1. */
  salary_percentile: number;
  /** score_percentile - salary_percentile: positive is more production than pay. */
  value_gap: number;
  category: ValueCategory;
};

// The top of the ladder is its own group whatever it is paid: a max contract
// on an MVP candidate is neither a bargain nor a mistake.
export const MVP_CANDIDATE_RANK = 10;
// How far production and pay have to sit apart, in percentile points, before a
// player stops being average value.
export const VALUE_GAP = 0.3;
// A handful of games swings a per-game score too much to judge a contract by.
export const MIN_GAMES = 20;

export const VALUE_CATEGORIES: { key: ValueCategory; label: string; color: string }[] = [
  { key: "mvp", label: "MVP candidate", color: "#5B3A8C" },
  { key: "undervalued", label: "Undervalued", color: "#2D5A27" },
  { key: "overpaid", label: "Overpaid", color: "#9B2C22" },
  { key: "fair", label: "Average", color: "#C9C4B7" },
];

/**
 * The games a player needs to be plotted. Early in a season nobody has
 * MIN_GAMES yet, so the bar is half of what the busiest player has played.
 */
export function minGamesFor(rows: PlayerValue[]) {
  const most = Math.max(0, ...rows.map((row) => row.games_played));
  return Math.min(MIN_GAMES, Math.ceil(most / 2));
}

function percentile(values: number[], value: number) {
  if (values.length < 2) return 0.5;
  const below = values.filter((other) => other < value).length;
  return below / (values.length - 1);
}

function categoryFor(row: PlayerValue, gap: number): ValueCategory {
  if (row.mvp_rank <= MVP_CANDIDATE_RANK) return "mvp";
  if (gap >= VALUE_GAP) return "undervalued";
  if (gap <= -VALUE_GAP) return "overpaid";
  return "fair";
}

/** Plot points for everyone with enough games, each sorted into a value group. */
export function playerValuePoints(rows: PlayerValue[]): PlayerValuePoint[] {
  const minGames = minGamesFor(rows);
  const eligible = rows.filter(
    (row) =>
      row.games_played >= minGames && Number.isFinite(row.mvp_score) && Number.isFinite(row.salary)
  );
  const scores = eligible.map((row) => row.mvp_score);
  const salaries = eligible.map((row) => row.salary);
  return eligible.map((row) => {
    const scorePercentile = percentile(scores, row.mvp_score);
    const salaryPercentile = percentile(salaries, row.salary);
    const gap = scorePercentile - salaryPercentile;
    return {
      ...row,
      salary_millions: row.salary / 1_000_000,
      score_percentile: scorePercentile,
      salary_percentile: salaryPercentile,
      value_gap: gap,
      category: categoryFor(row, gap),
    };
  });
}

export function isPicked(
  point: PlayerValuePoint,
  teams: ReadonlySet<string>,
  players: ReadonlySet<string>
) {
  return (
    players.has(point.player_id) ||
    (point.team_abbreviation != null && teams.has(point.team_abbreviation))
  );
}

const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

/** "Shai Gilgeous-Alexander" -> "Gilgeous-Alexander", "Jaren Jackson Jr." -> "Jackson Jr." */
export function plotLabel(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName.trim();
  const last = parts[parts.length - 1];
  if (SUFFIXES.has(last.toLowerCase()) && parts.length > 2) {
    return `${parts[parts.length - 2]} ${last}`;
  }
  return last;
}

/**
 * Evenly spaced round ticks covering low..high, e.g. 1..31.5 by 5 gives
 * 0, 5, ... 35. The first and last ticks are the axis ends, so no dot sits
 * outside them and the axis never starts on an odd number like -3.
 */
export function axisTicks(low: number, high: number, step: number) {
  const start = Math.floor(low / step) * step;
  const end = Math.max(Math.ceil(high / step) * step, start + step);
  const ticks: number[] = [];
  for (let tick = start; tick <= end; tick += step) ticks.push(tick);
  return ticks;
}

/** Lowercased with diacritics removed, so "jokic" finds "Jokić". */
export function foldName(name: string) {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}
