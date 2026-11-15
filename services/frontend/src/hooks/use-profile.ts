"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getProfileAction,
  setFollowOrderAction,
  setTeamFollowAction,
  setTimezoneAction,
} from "@/app/account/actions";
import { useAccount } from "@/lib/account";
import type { AccountProfile, Follow } from "@/lib/types";

const PROFILE_KEY = ["account-profile"];

type StoredProfile = Pick<AccountProfile, "user" | "follows">;

const NO_FOLLOWS: Follow[] = [];

/**
 * The signed-in visitor's stored account: when it was created, the time zone
 * they chose and the teams they follow. `timezone` is null for a visitor with
 * no session or no choice, which every caller reads as Eastern; `follows` is
 * empty for them.
 */
export function useProfile() {
  const { account } = useAccount();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: PROFILE_KEY,
    queryFn: async (): Promise<StoredProfile> => {
      const result = await getProfileAction();
      if (!result.ok) throw new Error(result.message);
      return { user: result.data.user, follows: result.data.follows ?? [] };
    },
    enabled: Boolean(account?.hasAccount),
    // Read on most pages for the time zone and follows, which only this hook's
    // own mutations change, so one fetch lasts until the page is reloaded.
    staleTime: Infinity,
    retry: false,
  });

  const setTimezone = useMutation({
    mutationFn: async (timezone: string | null) => {
      const result = await setTimezoneAction(timezone);
      if (!result.ok) throw new Error(result.message);
      return result.data;
    },
    onSuccess: (user: AccountProfile["user"]) =>
      queryClient.setQueryData<StoredProfile>(PROFILE_KEY, (stored) =>
        stored ? { ...stored, user } : stored
      ),
  });

  // Both follow mutations reply with the whole saved list.
  const storeFollows = (follows: Follow[]) =>
    queryClient.setQueryData<StoredProfile>(PROFILE_KEY, (stored) =>
      stored ? { ...stored, follows } : stored
    );

  const setTeamFollow = useMutation({
    mutationFn: async ({ teamId, following }: { teamId: string; following: boolean }) => {
      const result = await setTeamFollowAction(teamId, following);
      if (!result.ok) throw new Error(result.message);
      return result.data;
    },
    onSuccess: storeFollows,
  });

  // Arrows on Account move one team at a time; the reply is the saved order.
  const setFollowOrder = useMutation({
    mutationFn: async (teamIds: string[]) => {
      const result = await setFollowOrderAction(teamIds);
      if (!result.ok) throw new Error(result.message);
      return result.data;
    },
    onSuccess: storeFollows,
  });

  const follows = query.data?.follows ?? NO_FOLLOWS;
  const followedTeamIds = useMemo(
    () =>
      new Set(
        follows.filter((follow) => follow.entity_type === "team").map((follow) => follow.entity_id)
      ),
    [follows]
  );

  return {
    user: query.data?.user ?? null,
    timezone: query.data?.user.timezone ?? null,
    setTimezone,
    follows,
    followedTeamIds,
    setTeamFollow,
    setFollowOrder,
  };
}
