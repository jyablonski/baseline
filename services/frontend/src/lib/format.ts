export function formatNumber(value: number | null | undefined, digits = 0) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function formatStat(value: number | null | undefined, digits = 1) {
  return formatNumber(value, digits);
}

export function formatWinPct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(1)}%`;
}

export function formatWinPctPlain(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  const ratio = value > 1 ? value / 100 : value;
  return ratio.toFixed(3).replace(/^0/, "");
}

export function formatRecord(wins: number | null | undefined, losses: number | null | undefined) {
  if (wins == null || losses == null) return "—";
  return `${wins}–${losses}`;
}

export function formatRecordWithWinPct(
  wins: number | null | undefined,
  losses: number | null | undefined,
  winPct: number | null | undefined
) {
  const record = formatRecord(wins, losses);
  if (record === "—") return "—";
  return `${record} | ${formatWinPct(winPct)}`;
}

export function teamCentricMargin(
  teamScore: number | null | undefined,
  oppScore: number | null | undefined,
  scoreMargin: number | null | undefined,
  isWin: boolean | null | undefined
) {
  if (teamScore != null && oppScore != null) {
    return teamScore - oppScore;
  }
  if (scoreMargin == null || Number.isNaN(scoreMargin)) return null;
  if (isWin === false) return -Math.abs(scoreMargin);
  if (isWin === true) return Math.abs(scoreMargin);
  return scoreMargin;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function seasonFromDate(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const startYear = month >= 9 ? year : year - 1;
  const end = (startYear + 1) % 100;
  return `${startYear}-${String(end).padStart(2, "0")}`;
}

export function locationLabel(location: string | null | undefined) {
  if (!location) return "—";
  const value = location.toLowerCase();
  if (value === "home") return "Home";
  if (value === "away") return "Away";
  return location;
}

export function formatSeasonType(value: string | null | undefined) {
  if (!value) return "—";
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, "");
  if (key === "regularseason") return "Regular Season";
  if (key === "cup" || key === "nbacup") return "NBA Cup";
  if (key === "playoffs") return "Playoffs";
  if (key === "playin") return "Play-in";
  return value;
}

export function formatArenaCoords(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  digits = 4
) {
  if (latitude == null || longitude == null || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return null;
  }
  return `${latitude.toFixed(digits)}, ${longitude.toFixed(digits)}`;
}

export function formatUsd(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function formatUsdCompact(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const millions = value / 1_000_000;
    const digits = Number.isInteger(millions) ? 0 : 1;
    return `$${millions.toFixed(digits)}M`;
  }
  return formatUsd(value);
}

export function formatUsdMillions(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  const millions = value / 1_000_000;
  const rounded = Number(millions.toFixed(1));
  const digits = Number.isInteger(rounded) ? 0 : 1;
  return `$${rounded.toFixed(digits)}M`;
}

export function formatOrdinal(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  const remainder = value % 10;
  const teens = value % 100;
  if (teens >= 11 && teens <= 13) return `${value}th`;
  if (remainder === 1) return `${value}st`;
  if (remainder === 2) return `${value}nd`;
  if (remainder === 3) return `${value}rd`;
  return `${value}th`;
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatScrapedAt(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = date.getUTCDate();
  const month = SHORT_MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}

export function formatSignedMargin(value: number | null | undefined, digits?: number) {
  if (value == null || Number.isNaN(value)) return "—";
  const formatted =
    digits == null
      ? String(value)
      : value.toLocaleString(undefined, {
          maximumFractionDigits: digits,
          minimumFractionDigits: digits,
        });
  if (value > 0) return `+${formatted}`;
  return formatted;
}

export function formatBirthDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const formatted = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `b. ${formatted}`;
}

export function formatGamesBack(value: number | null | undefined) {
  if (value == null || Number.isNaN(value) || value === 0) return "—";
  return `${value} GB`;
}

export function playerSubtitle(
  team: string | null | undefined,
  position: string | null | undefined
) {
  return [team, position].filter((part) => Boolean(part) && part !== "—").join(" · ");
}

export function taxApronStatus(flags: {
  over_luxury_tax?: boolean | null;
  over_first_apron?: boolean | null;
  over_second_apron?: boolean | null;
}) {
  if (
    flags.over_luxury_tax == null &&
    flags.over_first_apron == null &&
    flags.over_second_apron == null
  ) {
    return null;
  }
  const parts = [
    flags.over_luxury_tax == null ? null : flags.over_luxury_tax ? "Over tax" : "Under tax",
    flags.over_first_apron == null
      ? null
      : flags.over_first_apron
        ? "over 1st apron"
        : "under 1st apron",
    flags.over_second_apron == null
      ? null
      : flags.over_second_apron
        ? "over 2nd apron"
        : "under 2nd apron",
  ].filter(Boolean);
  return parts.join(" · ");
}

export function formatArenaLine(team: {
  arena_name?: string | null;
  arena_latitude?: number | null;
  arena_longitude?: number | null;
}) {
  const coords = formatArenaCoords(team.arena_latitude, team.arena_longitude);
  if (team.arena_name && coords) {
    return `${team.arena_name} · ${coords}`;
  }
  if (team.arena_name) return team.arena_name;
  return coords;
}
