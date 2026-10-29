// Plain-language lines for the game page, each built only from numbers the
// page already has: the game row, its meetings this season, the flow, and the
// box score. Nothing here is a judgment the data cannot back.
import { NOTABLE_LEAD, type BiggestRun } from "@/lib/game-flow";
import type { BoxScoreRow, GameDetail, GameFlow } from "@/lib/types";

/** Whether the home side won. Only meaningful once both scores are in. */
export function homeWon(game: Pick<GameDetail, "home_score" | "away_score">) {
  return (game.home_score ?? 0) > (game.away_score ?? 0);
}

/** A meeting of the two teams this season, played or not. */
export type Meeting = {
  game_id: string;
  game_date: string;
  start_time_et?: string | null;
  season_type?: string | null;
  home_team_abbreviation?: string | null;
  away_team_abbreviation?: string | null;
  home_score?: number | null;
  away_score?: number | null;
};

export type Stage = "Regular Season" | "NBA Cup" | "Play-In" | "Playoffs" | "NBA Finals";

/** A season type as a stage. A playoff series between conferences is the Finals. */
export function stageOf(
  seasonType: string | null | undefined,
  game: Pick<GameDetail, "home_team_conference" | "away_team_conference">
): Stage {
  if (seasonType === "Cup") return "NBA Cup";
  if (seasonType === "PlayIn") return "Play-In";
  if (seasonType === "Playoffs") {
    const { home_team_conference: home, away_team_conference: away } = game;
    return home && away && home !== away ? "NBA Finals" : "Playoffs";
  }
  return "Regular Season";
}

export function isSeriesStage(stage: Stage) {
  return stage === "Playoffs" || stage === "NBA Finals";
}

/** Which side of `game` a meeting's winner was, by abbreviation. */
function meetingWinner(meeting: Meeting, game: GameDetail): "home" | "away" | null {
  if (meeting.home_score == null || meeting.away_score == null) return null;
  const winner =
    meeting.home_score > meeting.away_score
      ? meeting.home_team_abbreviation
      : meeting.away_team_abbreviation;
  if (winner === game.home_team_abbreviation) return "home";
  if (winner === game.away_team_abbreviation) return "away";
  return null;
}

export type StageRecord = { stage: Stage; meetings: Meeting[]; homeWins: number; awayWins: number };

/** Meetings grouped by stage in season order, each with its record so far. */
export function stageRecords(game: GameDetail, meetings: Meeting[]): StageRecord[] {
  const order: Stage[] = ["Regular Season", "NBA Cup", "Play-In", "Playoffs", "NBA Finals"];
  const sorted = [...meetings].sort((a, b) => a.game_date.localeCompare(b.game_date));
  return order
    .map((stage) => {
      const inStage = sorted.filter((meeting) => stageOf(meeting.season_type, game) === stage);
      const winners = inStage.map((meeting) => meetingWinner(meeting, game));
      return {
        stage,
        meetings: inStage,
        homeWins: winners.filter((side) => side === "home").length,
        awayWins: winners.filter((side) => side === "away").length,
      };
    })
    .filter((record) => record.meetings.length > 0);
}

/** "Game 5" for a playoff game: its place among this series' meetings. */
export function seriesGameNumber(game: GameDetail, meetings: Meeting[]) {
  const stage = stageOf(game.season_type, game);
  if (!isSeriesStage(stage)) return null;
  const record = stageRecords(game, meetings).find((item) => item.stage === stage);
  const index = record?.meetings.findIndex((meeting) => meeting.game_id === game.game_id) ?? -1;
  return index >= 0 ? index + 1 : null;
}

/** The small line in the header: "NBA Finals, Game 5", "Season opener", or nothing. */
export function contextLine(game: GameDetail, meetings: Meeting[]) {
  const stage = stageOf(game.season_type, game);
  if (isSeriesStage(stage)) {
    const number = seriesGameNumber(game, meetings);
    return number ? `${stage}, Game ${number}` : stage;
  }
  if (stage !== "Regular Season") return stage;
  const unplayed =
    game.home_wins + game.home_losses === 0 && game.away_wins + game.away_losses === 0;
  return unplayed ? "Season opener" : null;
}

function nickname(game: GameDetail, side: "home" | "away") {
  return side === "home"
    ? (game.home_team_nickname ?? game.home_team_abbreviation ?? "Home")
    : (game.away_team_nickname ?? game.away_team_abbreviation ?? "Away");
}

/**
 * The recap's one-line headline for a Final game. None for a regular-season
 * game: "Nuggets beat the Hawks, 134–133" only repeats the scoreboard. Series
 * games say where the series stands; Cup and Play-In games keep the result,
 * since the stage is what makes it worth a line.
 */
export function recapHeadline(game: GameDetail, meetings: Meeting[]) {
  if (game.home_score == null || game.away_score == null) return null;
  if (stageOf(game.season_type, game) === "Regular Season") return null;
  const winnerSide = homeWon(game) ? "home" : "away";
  const loserSide = winnerSide === "home" ? "away" : "home";
  const winner = nickname(game, winnerSide);
  const high = Math.max(game.home_score, game.away_score);
  const low = Math.min(game.home_score, game.away_score);
  const stage = stageOf(game.season_type, game);

  if (isSeriesStage(stage)) {
    // The series as it stood after this game, so later games do not leak in.
    const through = meetings.filter((meeting) => meeting.game_date <= game.game_date);
    const record = stageRecords(game, through).find((item) => item.stage === stage);
    if (record) {
      const mine = winnerSide === "home" ? record.homeWins : record.awayWins;
      const theirs = winnerSide === "home" ? record.awayWins : record.homeWins;
      if (mine === 4) {
        return `${winner} win the ${stage === "NBA Finals" ? "NBA Finals" : "series"}, 4–${theirs}.`;
      }
      if (mine === theirs) return `${winner} even the series at ${mine}–${theirs}.`;
      if (mine > theirs) return `${winner} take a ${mine}–${theirs} series lead.`;
      return `${winner} pull within ${theirs}–${mine}.`;
    }
  }
  return `${winner} beat the ${nickname(game, loserSide)}, ${high}–${low}.`;
}

function periodName(period: number) {
  return period > 4 ? "overtime" : `Q${period}`;
}

/** One recap card: a big figure, whose it is, and a line of context. */
export type RecapCard = { label: string; figure: string; name: string; caption: string | null };

/** "3 reb, 3 ast · 16-29 FG" from a box score line. */
function statLine(row: BoxScoreRow) {
  const parts = [`${row.rebounds ?? 0} reb, ${row.assists ?? 0} ast`];
  if (row.field_goals_made != null && row.field_goals_attempted != null) {
    parts.push(`${row.field_goals_made}-${row.field_goals_attempted} FG`);
  }
  return parts.join(" · ");
}

function sideOf(game: GameDetail, winner: boolean) {
  return homeWon(game) === winner ? game.home_team_id : game.away_team_id;
}

/** The winning side's best line by game score (points when there is none). */
export function starCard(rows: BoxScoreRow[], game: GameDetail): RecapCard | null {
  if (game.home_score == null || game.away_score == null) return null;
  const winnerId = sideOf(game, true);
  const top = rows
    .filter((row) => row.team_id === winnerId && row.points != null && row.player_name)
    .sort(
      (a, b) =>
        (b.mvp_game_score ?? b.points ?? 0) - (a.mvp_game_score ?? a.points ?? 0) ||
        (b.points ?? 0) - (a.points ?? 0)
    )[0];
  if (!top) return null;
  const score = top.mvp_game_score != null ? ` · game score ${top.mvp_game_score.toFixed(1)}` : "";
  return {
    label: "Star",
    figure: String(top.points),
    name: top.player_name ?? "",
    caption: `${statLine(top)}${score}`,
  };
}

/** The losing side's top scorer, labelled "<team> top scorer". */
export function losingCard(rows: BoxScoreRow[], game: GameDetail, label: string): RecapCard | null {
  if (game.home_score == null || game.away_score == null) return null;
  const loserId = sideOf(game, false);
  const top = rows
    .filter((row) => row.team_id === loserId && row.points != null && row.player_name)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0];
  if (!top) return null;
  return {
    label: `${label} top scorer`,
    figure: String(top.points),
    name: top.player_name ?? "",
    caption: statLine(top),
  };
}

/**
 * How the winner got there: the run that decided it, with the deficits it
 * came back from; or a wire-to-wire lead; or the comeback alone.
 */
export function turningPointCard(flow: GameFlow, run: BiggestRun | null): RecapCard | null {
  const winner = flow.winning_team_abbreviation;
  if (!winner) return null;
  const winnerRun = run && run.biggest_run_team_abbreviation === winner ? run : null;
  const closing =
    winnerRun != null &&
    flow.game_elapsed_seconds != null &&
    winnerRun.biggest_run_end_seconds >= flow.game_elapsed_seconds - 1;

  const blown = flow.largest_lead_blown;
  const comeback =
    blown != null && blown >= NOTABLE_LEAD && flow.comeback_team_abbreviation === winner;
  const entering = flow.winner_margin_entering_fourth;
  // Latest deficit first: "by 7 entering Q4 and by 16 in Q2". When the biggest
  // deficit came in Q4 or overtime it is both the latest and the largest, so
  // the smaller one entering Q4 only muddles the order and is left out.
  const peakedLate = flow.blown_lead_period != null && flow.blown_lead_period >= 4;
  const deficits = comeback
    ? [
        entering != null && entering < 0 && !peakedLate
          ? `by ${Math.abs(entering)} entering Q4`
          : null,
        `by ${blown}${flow.blown_lead_period ? ` in ${periodName(flow.blown_lead_period)}` : ""}`,
      ]
        .filter(Boolean)
        .join(" and ")
    : null;

  if (winnerRun) {
    const caption = deficits
      ? `${closing ? "Closed the game" : "Came back"} after trailing ${deficits}`
      : flow.is_wire_to_wire
        ? "Never trailed"
        : closing
          ? "Closed the game"
          : null;
    return {
      label: "Turning point",
      figure: `${winnerRun.biggest_run_winner_points}–${winnerRun.biggest_run_opponent_points}`,
      name: `${winner} run`,
      caption,
    };
  }
  if (flow.is_wire_to_wire && flow.max_lead != null) {
    return {
      label: "Turning point",
      figure: `+${flow.max_lead}`,
      name: `${winner} max lead`,
      caption: "Never trailed",
    };
  }
  if (comeback && deficits) {
    return {
      label: "Turning point",
      figure: String(blown),
      name: "point comeback",
      caption: `${winner} won after trailing ${deficits}`,
    };
  }
  // No decisive run and no real comeback: the winner simply pulled away, so
  // say how far and for how long rather than leave the card out.
  const winnerIsHome = winner === flow.home_team_abbreviation;
  const winnerLead = winnerIsHome ? flow.max_home_lead : flow.max_away_lead;
  const winnerShare = winnerIsHome ? flow.home_lead_pct : flow.away_lead_pct;
  if ((winnerIsHome || winner === flow.away_team_abbreviation) && winnerLead != null) {
    return {
      label: "Turning point",
      figure: `+${winnerLead}`,
      name: `${winner} max lead`,
      caption: winnerShare != null ? `Led ${Math.round(winnerShare * 100)}% of the game` : null,
    };
  }
  return null;
}
