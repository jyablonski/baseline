"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** `pathname`, with `params` as its query when there are any. */
export function hrefWithParams(pathname: string, params: URLSearchParams) {
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Shows another day by writing `?date=` and keeping every other param. The
 * home day (today on /games) drops the param, so the bare URL always means
 * "home". Pushed, not replaced, so back and forward step through the days.
 */
export function useDayParam(home: string | null) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hrefFor = (date: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (date === home) params.delete("date");
    else params.set("date", date);
    return hrefWithParams(pathname, params);
  };
  const show = (date: string) => router.push(hrefFor(date), { scroll: false });
  return Object.assign(show, { hrefFor });
}
