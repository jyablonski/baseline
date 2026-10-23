"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Shows another day on a day-picker page by writing `?date=` and keeping every
 * other param. The page's home day (the newest results day, the soonest
 * schedule day) drops the param, so the bare URL always means "home".
 */
export function useDayParam(home: string | null) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (date: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (date === home) params.delete("date");
    else params.set("date", date);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
}
