"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getProfileAction, setTimezoneAction } from "@/app/account/actions";
import { useAccount } from "@/lib/account";
import type { AccountProfile } from "@/lib/types";

const PROFILE_KEY = ["account-profile"];

/**
 * The signed-in visitor's stored account: when it was created and the time
 * zone they chose. `timezone` is null for a visitor with no session or no
 * choice, which every caller reads as Eastern.
 */
export function useProfile() {
  const { account } = useAccount();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: PROFILE_KEY,
    queryFn: async () => {
      const result = await getProfileAction();
      if (!result.ok) throw new Error(result.message);
      return result.data.user;
    },
    enabled: Boolean(account?.hasAccount),
    // Read on most pages just for the time zone, which only this hook's own
    // mutation changes, so one fetch lasts until the page is reloaded.
    staleTime: Infinity,
    retry: false,
  });

  const setTimezone = useMutation({
    mutationFn: async (timezone: string | null) => {
      const result = await setTimezoneAction(timezone);
      if (!result.ok) throw new Error(result.message);
      return result.data;
    },
    onSuccess: (user: AccountProfile["user"]) => queryClient.setQueryData(PROFILE_KEY, user),
  });

  return { user: query.data ?? null, timezone: query.data?.timezone ?? null, setTimezone };
}
