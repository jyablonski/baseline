"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoadingState } from "@/components/query-state";
import { useGameDates } from "@/hooks/use-game-dates";

/**
 * The old Past Games address. Sends a visitor to /games on the latest day with
 * finals (or the `?date=` they asked for), keeping every other param. Replaces
 * this page in history, so back skips over it.
 */
export default function PastGamesRedirect() {
  return (
    <Suspense fallback={<LoadingState label="Loading games…" />}>
      <Redirect />
    </Suspense>
  );
}

function Redirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("date");
  const datesQuery = useGameDates({ enabled: !requested });
  const latest = datesQuery.data?.data[0]?.game_date.slice(0, 10);
  // With no finals (or the request failing) there is no day to name: plain /games.
  const ready = Boolean(requested) || datesQuery.isSuccess || datesQuery.isError;

  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(searchParams.toString());
    const date = requested ?? latest;
    if (date) params.set("date", date);
    const qs = params.toString();
    router.replace(qs ? `/games?${qs}` : "/games");
  }, [ready, requested, latest, searchParams, router]);

  return <LoadingState label="Loading games…" />;
}
