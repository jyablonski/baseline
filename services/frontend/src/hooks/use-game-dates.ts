"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

/** Every date with a Final game, newest first: one cached list for /games and its redirect. */
export function useGameDates({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["games", "dates"],
    queryFn: () => api.listGameDates(),
    enabled,
  });
}
