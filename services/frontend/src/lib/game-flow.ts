export function parseIsoClockToSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = value.trim().match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso) {
    const hours = iso[1] ? Number(iso[1]) : 0;
    const minutes = iso[2] ? Number(iso[2]) : 0;
    const seconds = iso[3] ? Number(iso[3]) : 0;
    if ([hours, minutes, seconds].some((part) => Number.isNaN(part))) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }
  const mmss = value.trim().match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!mmss) return null;
  const minutes = Number(mmss[1]);
  const seconds = Number(mmss[2]);
  if (Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
  return minutes * 60 + seconds;
}

export function periodStartElapsed(period: number): number {
  if (period <= 1) return 0;
  if (period <= 4) return (period - 1) * 720;
  return 4 * 720 + (period - 5) * 300;
}

export function periodLabel(period: number): string {
  if (period <= 4) return `Q${period}`;
  return `OT${period - 4}`;
}

export function quarterAxisTicks(maxPeriod: number | null | undefined) {
  const last = Math.max(maxPeriod ?? 4, 4);
  return Array.from({ length: last }, (_, index) => {
    const period = index + 1;
    return { seconds: periodStartElapsed(period), label: periodLabel(period) };
  });
}

export function formatMatchupTitle(flow: {
  away_team_name?: string | null;
  home_team_name?: string | null;
  away_team_abbreviation?: string | null;
  home_team_abbreviation?: string | null;
  winner_location?: string | null;
  winning_team_id?: string | null;
  away_team_id?: string;
  home_team_id?: string;
}): string {
  const away = flow.away_team_name ?? flow.away_team_abbreviation ?? "Away";
  const home = flow.home_team_name ?? flow.home_team_abbreviation ?? "Home";
  const awayWon =
    flow.winner_location === "away" ||
    (flow.winning_team_id != null && flow.winning_team_id === flow.away_team_id);
  const homeWon =
    flow.winner_location === "home" ||
    (flow.winning_team_id != null && flow.winning_team_id === flow.home_team_id);
  return `${away}${awayWon ? " (W)" : ""} @ ${home}${homeWon ? " (W)" : ""}`;
}

export function formatGameOption(game: {
  game_id: string;
  game_date?: string;
  away_team_abbreviation?: string | null;
  home_team_abbreviation?: string | null;
}): string {
  const away = game.away_team_abbreviation ?? "Away";
  const home = game.home_team_abbreviation ?? "Home";
  return `${away} @ ${home}`;
}

export const BIGGEST_RUN_MAX_SCORED = 25;

export type ScoringPlay = {
  elapsed_seconds: number;
  score_home: number;
  score_away: number;
};

export type BiggestRun = {
  biggest_run_team_abbreviation: string;
  biggest_run_winner_points: number;
  biggest_run_opponent_points: number;
  biggest_run_start_seconds: number;
  biggest_run_end_seconds: number;
  /** Indices into the events passed in: the run's first and last scoring play. */
  biggest_run_start_index: number;
  biggest_run_end_index: number;
  biggest_run_label: string;
};

type TeamAbbreviations = { homeAbbreviation?: string | null; awayAbbreviation?: string | null };

/** Who led and by how much, from the home-minus-away differential: "DAL +4". */
export function formatLead(differential: number, teams?: TeamAbbreviations): string {
  if (differential === 0) return "Tied";
  const abbr =
    differential > 0 ? teams?.homeAbbreviation || "Home" : teams?.awayAbbreviation || "Away";
  return `${abbr} +${Math.abs(differential)}`;
}

type ClockPoint = {
  period: number | null;
  clock: string | null;
  clock_remaining_seconds?: number | null;
};

/** "Q1 10:04–6:17", naming the second quarter only when the run crosses one. */
export function formatRunSpan(from: ClockPoint, to: ClockPoint): string {
  const fromPeriod = periodLabel(from.period ?? 1);
  const toPeriod = periodLabel(to.period ?? from.period ?? 1);
  const fromClock = formatGameClock(from.clock, from.clock_remaining_seconds);
  const toClock = formatGameClock(to.clock, to.clock_remaining_seconds);
  const samePeriod = fromPeriod === toPeriod;
  // Without both clocks a range would dangle, so say only the quarter(s).
  if (!fromClock || !toClock) return samePeriod ? fromPeriod : `${fromPeriod}–${toPeriod}`;
  return `${fromPeriod} ${fromClock}–${samePeriod ? toClock : `${toPeriod} ${toClock}`}`;
}

export function formatGameClock(
  clock?: string | null,
  remainingSeconds?: number | null
): string | null {
  const seconds =
    remainingSeconds != null && Number.isFinite(remainingSeconds)
      ? remainingSeconds
      : parseIsoClockToSeconds(clock);
  if (seconds == null) {
    const trimmed = clock?.trim();
    return trimmed || null;
  }
  return formatClockSeconds(Math.max(seconds, 0));
}

function formatClockSeconds(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const remainder = tenths % 600;
  const wholeSeconds = Math.floor(remainder / 10);
  const tenth = remainder % 10;
  const mmss = `${minutes}:${String(wholeSeconds).padStart(2, "0")}`;
  return tenth === 0 ? mmss : `${mmss}.${tenth}`;
}

export type FlowScoreParts = {
  away: string;
  home: string;
  scoreAway: number;
  scoreHome: number;
  signed: string;
};

/** Split out so the tooltip can tint each abbreviation with its team colour. */
export function flowTooltipScoreParts(
  value: unknown,
  point: {
    score_away: number;
    score_home: number;
    away_abbreviation?: string | null;
    home_abbreviation?: string | null;
  }
): FlowScoreParts {
  const differential = Number(value);
  const signed = Number.isNaN(differential)
    ? String(value)
    : differential > 0
      ? `+${differential}`
      : String(differential);
  return {
    away: point.away_abbreviation || "Away",
    home: point.home_abbreviation || "Home",
    scoreAway: point.score_away,
    scoreHome: point.score_home,
    signed,
  };
}

export function formatFlowTooltipScore(
  value: unknown,
  point: {
    score_away: number;
    score_home: number;
    away_abbreviation?: string | null;
    home_abbreviation?: string | null;
  }
): string {
  const parts = flowTooltipScoreParts(value, point);
  return `${parts.away} ${parts.scoreAway} – ${parts.home} ${parts.scoreHome} (${parts.signed})`;
}

export function formatFlowTooltipLabel(point?: {
  period: number | null;
  clock: string | null;
  clock_remaining_seconds?: number | null;
}): string {
  if (!point) return "";
  const quarter = point.period != null ? periodLabel(point.period) : "";
  const clock = formatGameClock(point.clock, point.clock_remaining_seconds);
  return [quarter, clock].filter(Boolean).join(" · ");
}

const LOOKS_LIKE_ID = /^(?:\d+|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;

export function formatFlowTooltipPlay(point?: {
  description?: string | null;
  player_name?: string | null;
  action_type?: string | null;
  sub_type?: string | null;
}): string | null {
  if (!point) return null;
  const description = humanPlayText(point.description);
  if (description) return description;
  const player = humanPlayText(point.player_name);
  const how = formatPlayHow(point.action_type, point.sub_type);
  const composed = [player, how].filter(Boolean).join(" ");
  return composed || null;
}

function humanPlayText(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || LOOKS_LIKE_ID.test(trimmed)) return null;
  return trimmed;
}

function formatPlayHow(actionType?: string | null, subType?: string | null): string | null {
  const tokens = [humanPlayText(actionType), humanPlayText(subType)].filter(
    (token): token is string => Boolean(token)
  );
  const unique = tokens.filter(
    (token, index, list) =>
      list.findIndex((other) => other.toLowerCase() === token.toLowerCase()) === index
  );
  const formatted = unique.map(formatPlayToken).filter((token): token is string => Boolean(token));
  return formatted.length ? formatted.join(" ") : null;
}

function formatPlayToken(token: string): string | null {
  if (/^(2[-\s]?pt)$/i.test(token)) return "2-PT";
  if (/^(3[-\s]?pt)$/i.test(token)) return "3-PT";
  if (/^(ft|free[-\s]?throw)$/i.test(token)) return "Free Throw";
  if (/^made shot$/i.test(token)) return null;
  return token;
}

export function selectBiggestRun(
  events: ScoringPlay[],
  teams?: TeamAbbreviations
): BiggestRun | null {
  if (events.length === 0) return null;
  const homeAbbr = teams?.homeAbbreviation || "Home";
  const awayAbbr = teams?.awayAbbreviation || "Away";

  let best: {
    net: number;
    purity: number;
    duration: number;
    start: number;
    end: number;
    teamAbbr: string;
    teamPts: number;
    oppPts: number;
    startIndex: number;
    endIndex: number;
  } | null = null;

  for (let startIndex = 0; startIndex < events.length; startIndex += 1) {
    const prevHome = startIndex === 0 ? 0 : events[startIndex - 1].score_home;
    const prevAway = startIndex === 0 ? 0 : events[startIndex - 1].score_away;
    for (let endIndex = startIndex; endIndex < events.length; endIndex += 1) {
      const homePts = events[endIndex].score_home - prevHome;
      const awayPts = events[endIndex].score_away - prevAway;
      const scored = homePts + awayPts;
      if (scored <= 0 || scored >= BIGGEST_RUN_MAX_SCORED) continue;
      if (homePts === awayPts) continue;

      const homeLeads = homePts > awayPts;
      const teamPts = homeLeads ? homePts : awayPts;
      const oppPts = homeLeads ? awayPts : homePts;
      const net = teamPts - oppPts;
      const purity = net / scored;
      const start = startIndex === 0 ? 0 : events[startIndex - 1].elapsed_seconds;
      const end = events[endIndex].elapsed_seconds;
      const duration = Math.max(end - start, 0);
      const candidate = {
        net,
        purity,
        duration,
        start,
        end,
        teamAbbr: homeLeads ? homeAbbr : awayAbbr,
        teamPts,
        oppPts,
        startIndex,
        endIndex,
      };
      if (isBetterRun(candidate, best)) best = candidate;
    }
  }

  if (!best) return null;
  return {
    biggest_run_team_abbreviation: best.teamAbbr,
    biggest_run_winner_points: best.teamPts,
    biggest_run_opponent_points: best.oppPts,
    biggest_run_start_seconds: best.start,
    biggest_run_end_seconds: best.end,
    biggest_run_start_index: best.startIndex,
    biggest_run_end_index: best.endIndex,
    biggest_run_label: `${best.teamAbbr} ${best.teamPts}–${best.oppPts}`,
  };
}

function isBetterRun(
  candidate: { net: number; purity: number; duration: number; start: number },
  current: { net: number; purity: number; duration: number; start: number } | null
): boolean {
  if (current == null) return true;
  if (candidate.net !== current.net) return candidate.net > current.net;
  if (candidate.purity !== current.purity) return candidate.purity > current.purity;
  if (candidate.duration !== current.duration) return candidate.duration < current.duration;
  return candidate.start < current.start;
}

// Only leads worth narrating: the median game swings a few points, so a
// turning point on every "trailed by 3" would be noise. 10 matches the blown-leads
// threshold used by the team_game_flow Cube measures.
export const NOTABLE_LEAD = 10;
