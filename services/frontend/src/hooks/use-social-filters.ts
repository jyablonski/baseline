"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  SOCIAL_SORTS,
  CONTENT_TYPE_LABELS,
  DEFAULT_SOCIAL_RANGE,
  DEFAULT_SOCIAL_SORT,
  isSocialRange,
  type SocialRangeKey,
} from "@/lib/social";

/** Feed filters live in the URL so a view is shareable, matching `useSeason`. */
export function useSocialFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rangeParam = searchParams.get("range");
  const range: SocialRangeKey = isSocialRange(rangeParam) ? rangeParam : DEFAULT_SOCIAL_RANGE;

  const typeParam = searchParams.get("type") ?? "";
  const contentType = typeParam in CONTENT_TYPE_LABELS ? typeParam : "";

  const sortParam = searchParams.get("sort") ?? "";
  const sort = SOCIAL_SORTS.some((item) => item.key === sortParam)
    ? sortParam
    : DEFAULT_SOCIAL_SORT;

  // Zero-based here, one-based in the URL, where page 1 is left off entirely.
  const pageParam = Number(searchParams.get("page"));
  const page = Number.isInteger(pageParam) && pageParam > 1 ? pageParam - 1 : 0;

  function set(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    // Any other filter changes what the feed holds, so a kept page would point
    // somewhere arbitrary, or past the end.
    if (key !== "page") params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return {
    range,
    contentType,
    sort,
    page,
    setRange: (next: SocialRangeKey) => set("range", next),
    setContentType: (next: string) => set("type", next),
    setSort: (next: string) => set("sort", next),
    setPage: (next: number) => set("page", next > 0 ? String(next + 1) : ""),
  };
}
