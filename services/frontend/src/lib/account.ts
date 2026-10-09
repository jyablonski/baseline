"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

export type AccountSession = {
  name: string | null;
  /** False when signed in but the account could not be registered yet. */
  hasAccount: boolean;
  /** Whether to show the site owner a link to /admin. Display only. */
  isAdmin: boolean;
};

/**
 * The visitor's session, read from NextAuth's own endpoint.
 *
 * A convenience for deciding what to draw. It is not a security check: every
 * server action re-reads the session itself.
 */
export async function fetchAccountSession(): Promise<AccountSession | null> {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      user?: { name?: string | null; userId?: string; isAdmin?: boolean };
    } | null;
    if (!body?.user) return null;
    return {
      name: body.user.name ?? null,
      hasAccount: Boolean(body.user.userId),
      isAdmin: body.user.isAdmin === true,
    };
  } catch {
    return null;
  }
}

export function useAccount() {
  const query = useQuery({
    queryKey: ["account-session"],
    queryFn: fetchAccountSession,
    staleTime: 60_000,
    retry: false,
  });
  return { account: query.data ?? null, isLoading: query.isPending };
}

/** Which switchable features are on. Off while loading, and off on error. */
export function useFeatures() {
  const query = useQuery({
    queryKey: ["features"],
    queryFn: () => api.getFeatures(),
    staleTime: 60_000,
    retry: false,
  });
  const flags = query.data ?? {};
  return {
    chatbot: flags.chatbot === true,
    picks: flags.picks === true,
    isLoading: query.isPending,
  };
}
