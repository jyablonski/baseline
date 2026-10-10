"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getPickSheetAction,
  removePickAction,
  savePickAction,
  type ActionResult,
} from "@/app/account/actions";
import { useAccount, useFeatures } from "@/lib/account";
import type { PickSheet } from "@/lib/types";

const PICK_SHEET_KEY = ["pick-sheet"];

/** Server actions report failure as a value; react-query wants a throw. */
function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

/**
 * The signed-in visitor's picks and record.
 *
 * `fetch: false` shares whatever is already cached without asking for it, for
 * a caller that is on every page and usually has nothing to show.
 */
export function usePicks({ fetch = true }: { fetch?: boolean } = {}) {
  const { account, isLoading: accountIsLoading } = useAccount();
  const features = useFeatures();
  const queryClient = useQueryClient();
  const enabled = Boolean(account?.hasAccount) && features.picks;

  const sheetQuery = useQuery({
    queryKey: PICK_SHEET_KEY,
    queryFn: async () => unwrap(await getPickSheetAction()),
    enabled: enabled && fetch,
    retry: false,
  });

  // Every write answers with the whole sheet, so what is on screen is what
  // the server holds.
  const onSuccess = (sheet: PickSheet) => queryClient.setQueryData(PICK_SHEET_KEY, sheet);

  const save = useMutation({
    mutationFn: async (pick: { gameId: string; teamId: string; stake: number | null }) =>
      unwrap(await savePickAction(pick.gameId, pick.teamId, pick.stake)),
    onSuccess,
  });
  const remove = useMutation({
    mutationFn: async (gameId: string) => unwrap(await removePickAction(gameId)),
    onSuccess,
  });

  return {
    enabled,
    isLoading: accountIsLoading || features.isLoading || (enabled && fetch && sheetQuery.isPending),
    error: sheetQuery.error,
    sheet: sheetQuery.data,
    save,
    remove,
  };
}
