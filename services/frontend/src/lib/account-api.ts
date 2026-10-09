/**
 * Server-only client for /api/v1/account.
 *
 * The browser never calls these routes. A server action checks the session,
 * then calls here with ACCOUNTS_API_TOKEN and the caller's internal id; the
 * token is what lets the API believe that id. Like ADMIN_API_TOKEN it is
 * deliberately not a NEXT_PUBLIC_ variable. Do not import this from a
 * "use client" file.
 */
import type { AccountProfile, ChatReply, ChatTurn, PickSheet } from "@/lib/types";

export class AccountApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AccountApiError";
    this.status = status;
  }
}

const UNAVAILABLE = "Accounts are not available right now.";

function accountApiBase(): string {
  return (
    process.env.ACCOUNTS_API_URL ||
    process.env.ADMIN_API_URL ||
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000"
  );
}

async function accountFetch<T>(
  path: string,
  options: { userId?: string; method?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  const token = process.env.ACCOUNTS_API_TOKEN;
  if (!token) throw new AccountApiError(UNAVAILABLE, 503);

  let response: Response;
  try {
    response = await fetch(`${accountApiBase()}/api/v1/account${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.userId ? { "X-Baseline-User": options.userId } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch {
    throw new AccountApiError(UNAVAILABLE, 0);
  }

  if (!response.ok) {
    // The API writes `detail` for the person reading it. Anything else (a
    // validation array, an HTML error page) is not shown.
    let message = UNAVAILABLE;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      /* not JSON */
    }
    throw new AccountApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Create or touch the account behind an OAuth identity and return its id.
 *
 * Never throws: this runs inside the sign-in callback, and the admin console
 * has to stay reachable when the accounts API is down or not configured. An
 * undefined id leaves the session valid and the account features unavailable.
 */
export async function registerAccount(identity: {
  provider: string;
  subject: string;
  displayName?: string | null;
}): Promise<string | undefined> {
  if (!process.env.ACCOUNTS_API_TOKEN) return undefined;
  try {
    const body = await accountFetch<{ data: { user_id: string } }>("/users", {
      method: "POST",
      body: {
        provider: identity.provider,
        provider_subject: identity.subject,
        display_name: identity.displayName?.slice(0, 100) || null,
      },
      timeoutMs: 5_000,
    });
    return body.data.user_id;
  } catch {
    return undefined;
  }
}

export async function fetchProfile(userId: string): Promise<AccountProfile> {
  return (await accountFetch<{ data: AccountProfile }>("/me", { userId })).data;
}

export async function deleteAccount(userId: string): Promise<void> {
  await accountFetch<void>("/me", { userId, method: "DELETE" });
}

export async function fetchPickSheet(userId: string): Promise<PickSheet> {
  return (await accountFetch<{ data: PickSheet }>("/picks", { userId })).data;
}

export async function savePick(
  userId: string,
  gameId: string,
  pick: { teamId: string; stake: number | null }
): Promise<PickSheet> {
  const body = await accountFetch<{ data: PickSheet }>(`/picks/${encodeURIComponent(gameId)}`, {
    userId,
    method: "PUT",
    body: { picked_team_id: pick.teamId, stake: pick.stake },
  });
  return body.data;
}

export async function deletePick(userId: string, gameId: string): Promise<PickSheet> {
  const body = await accountFetch<{ data: PickSheet }>(`/picks/${encodeURIComponent(gameId)}`, {
    userId,
    method: "DELETE",
  });
  return body.data;
}

export async function sendChat(
  userId: string,
  messages: ChatTurn[],
  season?: string
): Promise<ChatReply> {
  return accountFetch<ChatReply>("/chat", {
    userId,
    method: "POST",
    body: { messages, season: season || null },
    // A tool loop is several model calls; the default would cut it short.
    timeoutMs: 90_000,
  });
}
