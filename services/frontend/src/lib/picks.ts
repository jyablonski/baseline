import type { UserPick } from "@/lib/types";

/** Mirrors the API's bound. With no balance, this is what limits a stake. */
export const MAX_STAKE = 1000;

export const STAKE_PRESETS = [10, 25, 50, 100] as const;

/**
 * What a winning stake returns on top of itself, in dollars to the cent.
 * Mirrors `pick_profit_cents` in the API, which is the figure that settles.
 */
export function pickProfit(stake: number, moneyline: number) {
  const cents =
    moneyline > 0 ? stake * moneyline : Math.floor((stake * 100 * 100) / Math.abs(moneyline));
  return cents / 100;
}

/** "$10" for whole dollars, "$10.40" otherwise. */
export function formatMoney(value: number) {
  const whole = Number.isInteger(value);
  return `$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** A net: "+$37.15", "−$50", or "$0". */
export function formatSignedMoney(value: number) {
  if (value > 0) return `+${formatMoney(value)}`;
  if (value < 0) return `−${formatMoney(value)}`;
  return "$0";
}

/** An American price with a real minus, to sit beside team abbreviations. */
export function formatPrice(moneyline: number | null | undefined) {
  if (moneyline == null) return "";
  return moneyline > 0 ? `+${moneyline}` : `−${Math.abs(moneyline)}`;
}

/** Which side a pick took, as "PHI +159 at NYK" or "DEN −145 vs UTA". */
export function pickLabel(pick: UserPick) {
  const home = pick.picked_team_id === pick.home_team_id;
  const mine = home ? pick.home_team_abbreviation : pick.away_team_abbreviation;
  const theirs = home ? pick.away_team_abbreviation : pick.home_team_abbreviation;
  if (!mine || !theirs) return "No longer scheduled";
  const price = formatPrice(pick.moneyline);
  return `${mine}${price ? ` ${price}` : ""} ${home ? "vs" : "at"} ${theirs}`;
}

/** "PHI 112–108", winner first, once a game is final. */
export function finalScore(pick: UserPick) {
  if (pick.home_score == null || pick.away_score == null) return null;
  const homeWon = pick.home_score > pick.away_score;
  const winner = homeWon ? pick.home_team_abbreviation : pick.away_team_abbreviation;
  const high = Math.max(pick.home_score, pick.away_score);
  const low = Math.min(pick.home_score, pick.away_score);
  return `${winner ?? ""} ${high}–${low}`.trim();
}

/**
 * The win worth the most: the largest payout when anything was staked,
 * otherwise the win taken at the longest odds.
 */
export function bestCall(picks: UserPick[]) {
  const wins = picks.filter((pick) => pick.result === "won" && pick.moneyline != null);
  const paid = wins.filter((pick) => (pick.profit ?? 0) > 0);
  if (paid.length > 0) return paid.sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0))[0];
  return wins.sort((a, b) => (b.moneyline ?? 0) - (a.moneyline ?? 0))[0];
}
