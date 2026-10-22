"use client";

import { useProfile } from "@/hooks/use-profile";
import { formatDailyRefresh } from "@/lib/timezones";

/** The daily refresh time in the account's time zone, Eastern by default. */
export function RefreshTime() {
  const { timezone } = useProfile();
  return <>{formatDailyRefresh(timezone)}</>;
}
