import {
  formatDate,
  formatGamesBack,
  formatNumber,
  formatRecord,
  formatStat,
  formatUsdCompact,
  formatWinPctPlain,
} from "@/lib/format";

const HIDDEN_COLUMNS = new Set([
  "player_id",
  "team_id",
  "filters_applied",
  "game_list",
  "match_method",
  "source",
  "is_active",
]);

const ALIAS_IF_PREFERRED = [
  ["player_name", "full_name"],
  ["total_b2b_games", "total_back_to_backs"],
  ["avg_pts_in_b2b", "avg_pts_b2b"],
  // The abbreviation is the Team column; the full name beside it only repeats it.
  ["team_name", "abbreviation"],
] as const;

const COLUMN_LABELS: Record<string, string> = {
  // Overall / Home / Away: the row labels say what the column is.
  split: "",
  full_name: "Player",
  player_name: "Player",
  team_name: "Team",
  abbreviation: "Team",
  season: "Season",
  conference: "Conf",
  conference_rank: "#",
  record: "W-L",
  wins: "W",
  losses: "L",
  win_pct: "Win %",
  games: "Games",
  games_played: "GP",
  games_back: "GB",
  streak: "Streak",
  last_10: "L10",
  career_games_played: "Games",
  career_ppg: "PPG",
  career_rpg: "RPG",
  career_apg: "APG",
  seasons_played: "Seasons",
  total_points: "Points",
  teams_played_for: "Teams",
  ppg: "PPG",
  rpg: "RPG",
  apg: "APG",
  total_back_to_backs: "B2Bs",
  games_played_in_b2b: "Played",
  games_sat_in_b2b: "Sat",
  avg_pts_b2b: "PPG B2B",
  avg_pts_non_b2b: "PPG non-B2B",
  avg_pts_overall: "PPG",
  current_contract_season: "Season",
  current_season_salary: "Salary",
  current_season_payroll: "Payroll",
  current_remaining_guaranteed: "Guaranteed",
};

const MONEY_KEYS = new Set([
  "current_season_salary",
  "current_season_payroll",
  "current_remaining_guaranteed",
  "salary",
  "payroll",
]);

const STAT_KEYS = new Set([
  "ppg",
  "rpg",
  "apg",
  "career_ppg",
  "career_rpg",
  "career_apg",
  "avg_pts_b2b",
  "avg_pts_non_b2b",
  "avg_pts_overall",
  "avg_pts_in_b2b",
]);

function shortKey(key: string) {
  return key.includes(".") ? (key.split(".").pop() ?? key) : key;
}

function isEmptyValue(value: unknown) {
  if (value == null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function isRecordShape(value: unknown): value is { wins?: unknown; losses?: unknown } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function askDisplayRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    if (!("wins" in row) && !("losses" in row)) return row;
    const next = { ...row };
    next.record = { wins: next.wins, losses: next.losses };
    delete next.wins;
    delete next.losses;
    return next;
  });
}

export function askTableColumns(rows: Record<string, unknown>[]): string[] {
  const display = askDisplayRows(rows);
  const keys = Object.keys(display[0] ?? {});
  const present = new Set(keys);
  const shorts = new Set(keys.map(shortKey));
  return keys.filter((key) => {
    if (HIDDEN_COLUMNS.has(key) || HIDDEN_COLUMNS.has(shortKey(key))) return false;
    if (key.endsWith("_id")) return false;
    if (key.includes(".") && shorts.has(shortKey(key)) && present.has(shortKey(key))) {
      return false;
    }
    if (ALIAS_IF_PREFERRED.some(([alias, preferred]) => key === alias && present.has(preferred))) {
      return false;
    }
    return !display.every((row) => isEmptyValue(row[key]));
  });
}

export function askTableLabel(key: string) {
  const short = shortKey(key);
  if (key in COLUMN_LABELS) return COLUMN_LABELS[key];
  if (short in COLUMN_LABELS) return COLUMN_LABELS[short];
  return short.replaceAll("_", " ");
}

export function isAskNumericColumn(key: string) {
  const short = shortKey(key);
  return (
    MONEY_KEYS.has(short) ||
    STAT_KEYS.has(short) ||
    short === "win_pct" ||
    short === "games_back" ||
    short === "record" ||
    short === "conference_rank" ||
    short.endsWith("_played") ||
    short.startsWith("avg_") ||
    short.startsWith("total_") ||
    short.startsWith("career_") ||
    ["games", "wins", "losses", "gp"].includes(short)
  );
}

export function formatAskCell(value: unknown, column?: string) {
  if (value == null || value === "") return "—";
  const key = column ? shortKey(column) : "";

  if (key === "record" && isRecordShape(value)) {
    return formatRecord(
      typeof value.wins === "number" ? value.wins : null,
      typeof value.losses === "number" ? value.losses : null
    );
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (
    key &&
    (MONEY_KEYS.has(key) ||
      key.includes("salary") ||
      key.includes("payroll") ||
      key.includes("guaranteed"))
  ) {
    const amount = typeof value === "number" ? value : Number(value);
    return Number.isFinite(amount) ? formatUsdCompact(amount) : "—";
  }
  if (key === "win_pct" || key.endsWith("_win_pct")) {
    const pct = typeof value === "number" ? value : Number(value);
    return Number.isFinite(pct) ? formatWinPctPlain(pct) : "—";
  }
  if (key === "games_back" || key === "conf_games_back") {
    const gb = typeof value === "number" ? value : Number(value);
    return Number.isFinite(gb) ? formatGamesBack(gb) : "—";
  }
  if (key.includes("date") || key === "as_of_date") {
    return formatDate(String(value));
  }
  if (key && (STAT_KEYS.has(key) || /^(career_)?[pra]pg$/.test(key) || key.startsWith("avg_pts"))) {
    const stat = typeof value === "number" ? value : Number(value);
    return Number.isFinite(stat) ? formatStat(stat) : "—";
  }
  if (typeof value === "number") {
    return formatNumber(value, Number.isInteger(value) ? 0 : 1);
  }
  return String(value);
}
