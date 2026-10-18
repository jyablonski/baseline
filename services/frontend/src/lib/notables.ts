import { formatMoneyline, formatProbability, formatRecord } from "@/lib/format";
import { periodLabel } from "@/lib/game-flow";
import type { ClosestGame, GameCollapse, GameUpset, LargestMarginGame } from "@/lib/types";

// Comebacks first: it fills from opening night, while upsets wait on captured lines.
export const NOTABLE_TABS = ["comebacks", "upsets", "closest", "margins"] as const;
export type NotableTab = (typeof NOTABLE_TABS)[number];

export const NOTABLE_TAB_INFO: Record<
  NotableTab,
  { label: string; description: string; headline: string; secondary: string; empty: string }
> = {
  comebacks: {
    label: "Comebacks",
    description: "The biggest deficits a team came back from to win, from play-by-play.",
    headline: "Deficit erased",
    secondary: "Final margin",
    empty: "No comebacks yet this season.",
  },
  upsets: {
    label: "Upsets",
    description: "Underdog wins, ranked by how unlikely the morning line made them.",
    headline: "Market win %",
    secondary: "Line",
    empty: "No upsets yet this season. An upset needs a final result and a pregame line.",
  },
  closest: {
    label: "Closest games",
    description: "Smallest final margin first, then the most lead changes.",
    headline: "Margin",
    secondary: "Lead changes",
    empty: "No final games yet this season.",
  },
  margins: {
    label: "Largest margins",
    description: "The most lopsided finals of the season.",
    headline: "Margin",
    secondary: "Final",
    empty: "No final games yet this season.",
  },
};

export function notableTab(value: string | null | undefined): NotableTab {
  return NOTABLE_TABS.find((tab) => tab === value) ?? "comebacks";
}

/**
 * One notable game as a row. The line reads `team verb opponent, score`
 * ("WAS won at DEN, 118–112"); the parts stay separate so each team can carry
 * its logo. `score` is empty when the score has a column of its own or is
 * unknown. A tag marks which side of the result the filtered team was on, in
 * words, not colour alone.
 */
export type NotableRow = {
  gameId: string;
  date: string | null | undefined;
  team: string;
  verb: string;
  opponent: string;
  score: string;
  context: string | null;
  note: string | null;
  tag: { label: string; tone: "win" | "loss" } | null;
  headline: string;
  headlineNote: string | null;
  secondary: string;
};

/** "1 in 12": how often a result this unlikely happens. */
export function oneIn(probability: number): string {
  return `1 in ${Math.round(1 / probability)}`;
}

function points(value: number) {
  return `${value} ${value === 1 ? "pt" : "pts"}`;
}

function overtimeLabel(periods: number | null | undefined) {
  if (!periods) return null;
  return periods === 1 ? "OT" : `${periods}OT`;
}

/**
 * Both sides of a result, read from the filtered team's when that team lost,
 * otherwise from the winner's. `team`, `opponent` and `score` are in reading
 * order for the row's line.
 */
function readFrom(
  game: {
    home_team_abbreviation?: string | null;
    away_team_abbreviation?: string | null;
    home_score?: number | null;
    away_score?: number | null;
  },
  homeWon: boolean,
  team?: string
) {
  const home = { abbreviation: game.home_team_abbreviation ?? "Home", score: game.home_score };
  const away = { abbreviation: game.away_team_abbreviation ?? "Away", score: game.away_score };
  const [winner, loser] = homeWon ? [home, away] : [away, home];
  const fromLoser = Boolean(team) && team === loser.abbreviation;
  const [own, other] = fromLoser ? [loser, winner] : [winner, loser];
  return {
    winner,
    loser,
    fromLoser,
    team: own.abbreviation,
    opponent: other.abbreviation,
    score: scoreLine(own.score, other.score),
  };
}

function scoreLine(own: number | null | undefined, other: number | null | undefined) {
  return own != null && other != null ? `${own}–${other}` : "";
}

/** The row's line as one sentence: "SAC beat LAL, 123–120". */
export function rowLine(row: Pick<NotableRow, "team" | "verb" | "opponent" | "score">) {
  return `${row.team} ${row.verb} ${row.opponent}${row.score ? `, ${row.score}` : ""}`;
}

export function comebackRow(collapse: GameCollapse, team?: string): NotableRow {
  const side = readFrom(
    collapse,
    collapse.comeback_team_abbreviation === collapse.home_team_abbreviation,
    team
  );
  const { winner, loser, fromLoser } = side;
  const margin =
    winner.score != null && loser.score != null ? Math.abs(winner.score - loser.score) : null;
  const lead = collapse.largest_lead_blown;
  const period =
    collapse.blown_lead_period != null ? ` in ${periodLabel(collapse.blown_lead_period)}` : "";
  return {
    gameId: collapse.game_id,
    date: collapse.game_date,
    team: side.team,
    verb: fromLoser ? "lost to" : "beat",
    opponent: side.opponent,
    score: side.score,
    context: fromLoser ? `led by ${lead}${period}` : `trailed by ${lead}${period}`,
    note: null,
    tag: team
      ? fromLoser
        ? { label: "Blew it", tone: "loss" }
        : { label: "Came back", tone: "win" }
      : null,
    headline: points(lead),
    headlineNote: null,
    secondary: margin == null ? "—" : fromLoser ? `Lost by ${margin}` : `Won by ${margin}`,
  };
}

export function upsetRow(upset: GameUpset, team?: string): NotableRow {
  const homeWon = upset.winner_location === "home";
  const side = readFrom(upset, homeWon, team);
  const { fromLoser } = side;

  const homeRecord = [upset.home_wins, upset.home_losses];
  const awayRecord = [upset.away_wins, upset.away_losses];
  // 0–0 vs 0–0 on opening night says nothing.
  const played = [...homeRecord, ...awayRecord].some((value) => (value ?? 0) > 0);
  // The line's team first: the winner, or the loser when the filter reads from it.
  const ownIsHome = homeWon !== fromLoser;
  const [own, other] = ownIsHome ? [homeRecord, awayRecord] : [awayRecord, homeRecord];
  const records = played
    ? `${formatRecord(own[0], own[1])} vs ${formatRecord(other[0], other[1])}`
    : null;
  const absences = [
    { abbreviation: upset.home_team_abbreviation ?? "Home", names: upset.home_notable_out ?? [] },
    { abbreviation: upset.away_team_abbreviation ?? "Away", names: upset.away_notable_out ?? [] },
  ]
    .filter((item) => item.names.length > 0)
    .map((item) => `${item.abbreviation} without ${item.names.join(", ")}`);

  return {
    gameId: upset.game_id,
    date: upset.game_date,
    team: side.team,
    verb: fromLoser ? `lost ${homeWon ? "at" : "vs"}` : `won ${homeWon ? "vs" : "at"}`,
    opponent: side.opponent,
    score: side.score,
    context: [records, ...absences].filter(Boolean).join(" · ") || null,
    note: upset.model_called_upset ? "Model called it" : null,
    tag: team
      ? fromLoser
        ? { label: "Upset loss", tone: "loss" }
        : { label: "Upset win", tone: "win" }
      : null,
    headline: formatProbability(upset.winner_market_wp),
    headlineNote: oneIn(upset.winner_market_wp),
    secondary:
      upset.winner_fair_moneyline == null ? "—" : formatMoneyline(upset.winner_fair_moneyline),
  };
}

export function closestRow(game: ClosestGame, team?: string): NotableRow {
  const side = readFrom(game, game.winning_team_abbreviation === game.home_team_abbreviation, team);
  return {
    gameId: game.game_id,
    date: game.game_date,
    team: side.team,
    verb: side.fromLoser ? "lost to" : "beat",
    opponent: side.opponent,
    score: side.score,
    context: overtimeLabel(game.overtime_periods),
    note: null,
    tag: null,
    headline: points(game.final_margin),
    headlineNote: null,
    secondary: game.lead_changes == null ? "—" : String(game.lead_changes),
  };
}

export function marginRow(game: LargestMarginGame, team?: string): NotableRow {
  const side = readFrom(game, game.winning_team_abbreviation === game.home_team_abbreviation, team);
  // The score sits in its own column here, so the line names only the result.
  return {
    gameId: game.game_id,
    date: game.game_date,
    team: side.team,
    verb: side.fromLoser ? "lost to" : "beat",
    opponent: side.opponent,
    score: "",
    // is_wire_to_wire means the loser never led; ties along the way still count.
    context: game.is_wire_to_wire ? (side.fromLoser ? "never led" : "never trailed") : null,
    note: null,
    tag: null,
    headline: points(game.final_margin),
    headlineNote: null,
    secondary: side.score || "—",
  };
}
