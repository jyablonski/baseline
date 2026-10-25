import { formatScheduleDate } from "@/lib/format";

/** Game times are stored as Eastern wall-clock time, and shown that way by default. */
export const DEFAULT_TIMEZONE = "America/New_York";

/**
 * The time zones an account may choose. The API accepts exactly these names
 * (`Timezone` in services/api/src/schemas/account.py); add to both together.
 */
export const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "America/Sao_Paulo", label: "Brasília (São Paulo)" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "UK (London)" },
  { value: "Europe/Paris", label: "Central Europe (Paris)" },
  { value: "Europe/Athens", label: "Eastern Europe (Athens)" },
  { value: "Asia/Kolkata", label: "India (Kolkata)" },
  { value: "Asia/Shanghai", label: "China (Shanghai)" },
  { value: "Asia/Manila", label: "Philippines (Manila)" },
  { value: "Asia/Tokyo", label: "Japan (Tokyo)" },
  { value: "Australia/Sydney", label: "Eastern Australia (Sydney)" },
] as const;

export function isTimezone(value: unknown): value is (typeof TIMEZONES)[number]["value"] {
  return TIMEZONES.some((zone) => zone.value === value);
}

/** What the wall clock in `timeZone` reads at `instant`, as if that reading were UTC. */
function wallClockAsUtc(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    })
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)])
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

/** The instant a game tips, from its Eastern date and Eastern "HH:MM" start. */
function tipOff(gameDate: string | null | undefined, startTimeEt: string | null | undefined) {
  const day = gameDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const time = startTimeEt?.match(/^(\d{1,2}):(\d{2})/);
  if (!day || !time || Number(time[1]) > 23 || Number(time[2]) > 59) return null;
  const wall = Date.UTC(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    Number(time[1]),
    Number(time[2])
  );
  // Eastern's offset on that day, read back from the zone itself so daylight
  // saving is whatever the calendar says it is.
  const offset = wallClockAsUtc(new Date(wall), DEFAULT_TIMEZONE) - wall;
  return new Date(wall - offset);
}

/**
 * Whether a game has tipped off. With no start time on file this is the start
 * of game day, the same fallback the API uses to lock picks.
 */
export function hasTipped(
  gameDate: string | null | undefined,
  startTimeEt: string | null | undefined,
  now = new Date()
) {
  const tip = tipOff(gameDate, startTimeEt || "00:00");
  return tip != null && tip.getTime() <= now.getTime();
}

/** How long after tip a game not yet scraped as Final still reads as live. */
export const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Where a game not yet Final stands by the clock alone: "upcoming" before tip,
 * "live" for the first three hours, "started" after that. No live feed is
 * read. With no start time on file a game locks at the start of game day but
 * is never called live, since nobody knows when it tipped.
 */
export function gamePhase(
  gameDate: string | null | undefined,
  startTimeEt: string | null | undefined,
  now = new Date()
): "upcoming" | "live" | "started" {
  if (!hasTipped(gameDate, startTimeEt, now)) return "upcoming";
  const tip = tipOff(gameDate, startTimeEt);
  if (tip && now.getTime() - tip.getTime() < LIVE_WINDOW_MS) return "live";
  return "started";
}

/**
 * The earliest game day that can still have a live game: the Eastern date
 * three hours ago, as "YYYY-MM-DD". A 10 PM tip stays on screen past midnight.
 */
export function liveWindowStartDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIMEZONE }).format(
    new Date(now.getTime() - LIVE_WINDOW_MS)
  );
}

/**
 * A game's date, start time and zone label as one account wants to read them.
 *
 * The date moves with the time: a 10 PM Eastern tip is the next morning in
 * London. With no start time there is nothing to shift, so the Eastern date
 * stands and the time is "TBD".
 */
export function formatGameTime(
  gameDate: string | null | undefined,
  startTimeEt: string | null | undefined,
  timezone: string | null | undefined
) {
  const tip = tipOff(gameDate, startTimeEt);
  if (!tip) return { date: formatScheduleDate(gameDate), time: "TBD", zone: "" };
  return formatInstant(tip, timezone);
}

/**
 * The tip's local date (formatGameTime's `date`) when it is not the game's
 * Eastern date (a 10 PM ET tip read from Europe), else null. A day view names
 * the Eastern date once, so rows only need a date of their own when they
 * disagree with it.
 */
export function otherLocalDate(tipDate: string, gameDate: string | null | undefined) {
  return tipDate === formatScheduleDate(gameDate) ? null : tipDate;
}

/** When the data was last scraped, read the way the account reads game times. */
export function formatScrapedAt(
  value: string | null | undefined,
  timezone: string | null | undefined
) {
  if (!value) return "—";
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "—";
  const { date, time, zone } = formatInstant(instant, timezone, "long");
  return `${date} · ${time} ${zone}`;
}

/** The host cron starts the daily refresh at this UTC hour all year. */
export const DAILY_REFRESH_UTC_HOUR = 12;

/**
 * Today's refresh time as one account reads it ("8:00 AM ET"). The cron is
 * pinned to UTC, so the local time moves with daylight saving.
 */
export function formatDailyRefresh(timezone: string | null | undefined, now = new Date()) {
  const instant = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DAILY_REFRESH_UTC_HOUR)
  );
  const { time, zone } = formatInstant(instant, timezone);
  return `${time} ${zone}`;
}

/** An instant as { date, time, zone } in the account's time zone; Eastern reads as "ET". */
export function formatInstant(
  instant: Date,
  timezone: string | null | undefined,
  weekday: "short" | "long" = "short"
) {
  const timeZone = timezone || DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: instant.toLocaleDateString("en-US", {
      weekday,
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone,
    }),
    time: `${part("hour")}:${part("minute")} ${part("dayPeriod")}`,
    // Eastern stays the "ET" the rest of the site says; elsewhere the zone
    // names itself (PDT, GMT+1), which also tells daylight time from standard.
    zone: timeZone === DEFAULT_TIMEZONE ? "ET" : part("timeZoneName"),
  };
}
