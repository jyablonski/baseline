"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Meeting } from "@/lib/game-story";
import type { GameDetail } from "@/lib/types";

/**
 * Every meeting of a game's two teams this season, played and still to come,
 * oldest first. Played ones come from the home team's game log and the rest
 * from the schedule: neither alone covers the whole season.
 */
export function useSeasonMeetings(game: GameDetail | undefined) {
  const enabled = Boolean(game);
  const key = [game?.home_team_id, game?.away_team_id, game?.season];
  const playedQuery = useQuery({
    queryKey: ["season-series", "played", ...key],
    queryFn: () =>
      api.getTeamGames(game!.home_team_id, {
        opponent_team_id: game!.away_team_id,
        season: game!.season,
        limit: 20,
      }),
    enabled,
  });
  const upcomingQuery = useQuery({
    queryKey: ["season-series", "upcoming", ...key],
    queryFn: () =>
      api.listSchedule({
        team_id: game!.home_team_id,
        opponent_team_id: game!.away_team_id,
        season: game!.season,
        status: "Scheduled",
        limit: 20,
      }),
    enabled,
  });

  const seen = new Set<string>();
  const meetings: Meeting[] = [
    ...(playedQuery.data?.data ?? []),
    ...(upcomingQuery.data?.data ?? []),
  ]
    .filter((meeting) => !seen.has(meeting.game_id) && seen.add(meeting.game_id))
    .sort((a, b) => a.game_date.localeCompare(b.game_date));

  return {
    meetings,
    isLoading: playedQuery.isLoading || upcomingQuery.isLoading,
    error: playedQuery.error ?? upcomingQuery.error,
  };
}
