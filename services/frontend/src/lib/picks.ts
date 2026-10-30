import { formatShortDate, isoDateET, isoDayBefore } from "@/lib/format";
import { formatGameTime, hasTipped, liveWindowStartDate } from "@/lib/timezones";
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

/** "62% correct" of the graded picks, or null with none graded. */
export function percentCorrect(wins: number, losses: number) {
  const graded = wins + losses;
  return graded > 0 ? `${Math.round((wins / graded) * 100)}% correct` : null;
}

/** Record and money for any slice of picks. Void picks count toward neither. */
export function pickTotals(picks: UserPick[]) {
  const wins = picks.filter((pick) => pick.result === "won").length;
  const losses = picks.filter((pick) => pick.result === "lost").length;
  const settled = picks.filter((pick) => pick.profit != null);
  // Summed in cents: adding dollars to the cent drifts in floating point.
  const netCents = settled.reduce((sum, pick) => sum + Math.round((pick.profit ?? 0) * 100), 0);
  const staked = settled.reduce((sum, pick) => sum + (pick.stake ?? 0), 0);
  return { wins, losses, net: netCents / 100, staked };
}

/**
 * The last graded picks, oldest first so the newest sits at the right end of
 * the strip. Takes picks newest first, as the API sends them.
 */
export function recentForm(picks: UserPick[], size = 20) {
  const graded = picks.filter((pick) => pick.result === "won" || pick.result === "lost");
  const recent = graded.slice(0, size).reverse();
  const { wins, losses } = pickTotals(recent);
  const season = pickTotals(graded);
  // Under a full window the strip is the whole season, so nothing to compare.
  let trend: string | null = null;
  if (graded.length > size) {
    const gap = wins / recent.length - season.wins / graded.length;
    trend =
      gap > 0
        ? "better than your season"
        : gap < 0
          ? "worse than your season"
          : "level with your season";
  }
  return { picks: recent, wins, losses, trend };
}

/** The side the model favoured, from whether its favourite won. Null if it made no call. */
export function modelTeamId(pick: UserPick) {
  if (pick.model_correct == null || pick.home_score == null || pick.away_score == null) return null;
  const homeWon = pick.home_score > pick.away_score;
  return homeWon === pick.model_correct ? pick.home_team_id : pick.away_team_id;
}

/** The abbreviation of the side the model favoured, or null. */
export function modelTeam(pick: UserPick) {
  const teamId = modelTeamId(pick);
  if (teamId == null) return null;
  return teamId === pick.home_team_id ? pick.home_team_abbreviation : pick.away_team_abbreviation;
}

/** The team a pick took. */
export function pickedTeam(pick: UserPick) {
  return pick.picked_team_id === pick.home_team_id
    ? pick.home_team_abbreviation
    : pick.away_team_abbreviation;
}

type Split = { id: string; label: string; test: (pick: UserPick) => boolean };

/** The Breakdown menu. Splits in one group exclude each other, so one is chosen at a time. */
export const PICK_SPLITS: { label: string; splits: Split[] }[] = [
  {
    label: "Price",
    splits: [
      { id: "favorite", label: "Favorites", test: (pick) => (pick.moneyline ?? 0) < 0 },
      { id: "underdog", label: "Underdogs", test: (pick) => (pick.moneyline ?? 0) > 0 },
    ],
  },
  {
    label: "Venue",
    splits: [
      { id: "home", label: "Home", test: (pick) => pick.picked_team_id === pick.home_team_id },
      { id: "away", label: "Away", test: (pick) => pick.picked_team_id === pick.away_team_id },
    ],
  },
  {
    label: "Stake",
    splits: [
      { id: "staked", label: "Staked", test: (pick) => pick.stake != null },
      { id: "record-only", label: "Record only", test: (pick) => pick.stake == null },
    ],
  },
  {
    label: "Model",
    splits: [
      {
        id: "with-model",
        label: "With the model",
        test: (pick) => modelTeamId(pick) === pick.picked_team_id,
      },
      {
        id: "against-model",
        label: "Against the model",
        test: (pick) => modelTeamId(pick) != null && modelTeamId(pick) !== pick.picked_team_id,
      },
    ],
  },
];

const ALL_SPLITS = PICK_SPLITS.flatMap((group) => group.splits);

export type SettledFilters = {
  range: "week" | "season";
  result: "all" | "won" | "lost";
  team: string;
  splits: string[];
};

/** Every filter on the settled list. Takes the date so "last 7 days" is testable. */
export function filterSettled(picks: UserPick[], filters: SettledFilters, today = isoDateET()) {
  let weekAgo = today;
  for (let day = 0; day < 7; day += 1) weekAgo = isoDayBefore(weekAgo);
  const splits = ALL_SPLITS.filter((split) => filters.splits.includes(split.id));
  return picks.filter(
    (pick) =>
      (filters.range === "season" || (pick.game_date ?? "").slice(0, 10) >= weekAgo) &&
      (filters.result === "all" || pick.result === filters.result) &&
      (!filters.team || pickedTeam(pick) === filters.team) &&
      splits.every((split) => split.test(pick))
  );
}

/** Adds a split or takes it off, replacing any other from its group. */
export function toggleSplit(chosen: string[], id: string) {
  const group = PICK_SPLITS.find(({ splits }) => splits.some((split) => split.id === id));
  const rivals = group?.splits.map((split) => split.id) ?? [];
  const others = chosen.filter((other) => !rivals.includes(other));
  return chosen.includes(id) ? others : [...others, id];
}

/** The label for a chosen split, for its filter chip. */
export function splitLabel(id: string) {
  return ALL_SPLITS.find((split) => split.id === id)?.label ?? id;
}

/** The Open line: "10 tonight · first lock 4:00 PM". */
export function openSummary(
  open: UserPick[],
  timezone: string | null | undefined,
  now = new Date()
) {
  const upcoming = open
    .filter((pick) => !hasTipped(pick.game_date, pick.start_time_et, now))
    .sort((a, b) =>
      `${a.game_date}${a.start_time_et}`.localeCompare(`${b.game_date}${b.start_time_et}`)
    );
  if (upcoming.length === 0) return `${open.length} awaiting final`;

  const today = liveWindowStartDate(now);
  const tonight = upcoming.filter((pick) => pick.game_date?.slice(0, 10) === today).length;
  const later = upcoming.length - tonight;
  const count = tonight > 0 ? `${tonight} tonight` : `${upcoming.length} open`;
  const first = upcoming[0];
  const tip = formatGameTime(first.game_date, first.start_time_et, timezone);
  const when =
    first.game_date?.slice(0, 10) === today
      ? tip.time
      : `${formatShortDate(first.game_date)}, ${tip.time}`;
  return [
    count,
    tonight > 0 && later > 0 ? `${later} later` : null,
    tip.zone ? `first lock ${when}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const CSV_COLUMNS = [
  "game_date",
  "start_time_et",
  "away_team",
  "home_team",
  "picked_team",
  "moneyline",
  "stake",
  "result",
  "profit",
  "away_score",
  "home_score",
  "picked_at",
];

/** Every pick as CSV, one row per game, for the visitor to keep. */
export function picksCsv(picks: UserPick[]) {
  const rows = picks.map((pick) => [
    pick.game_date?.slice(0, 10),
    pick.start_time_et,
    pick.away_team_abbreviation,
    pick.home_team_abbreviation,
    pickedTeam(pick),
    pick.moneyline,
    pick.stake,
    pick.result,
    pick.profit,
    pick.away_score,
    pick.home_score,
    pick.created_at,
  ]);
  return [CSV_COLUMNS, ...rows]
    .map((row) =>
      row
        .map((value) => {
          const text = value == null ? "" : String(value);
          return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join(",")
    )
    .join("\n");
}
