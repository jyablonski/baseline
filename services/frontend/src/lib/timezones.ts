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
  const timeZone = timezone || DEFAULT_TIMEZONE;
  const tip = tipOff(gameDate, startTimeEt);
  if (!tip) return { date: formatScheduleDate(gameDate), time: "TBD", zone: "" };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).formatToParts(tip);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: tip.toLocaleDateString("en-US", {
      weekday: "short",
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
