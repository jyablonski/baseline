"use server";

import { auth, refreshSession, signOut } from "@/auth";
import {
  AccountApiError,
  deleteAccount,
  deletePick,
  fetchPickSheet,
  fetchProfile,
  savePick,
  sendChat,
} from "@/lib/account-api";
import { MAX_STAKE } from "@/lib/picks";
import type { AccountProfile, ChatReply, ChatTurn, PickSheet } from "@/lib/types";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

// The API's per-message limit (schemas/account.py, MAX_CHAT_MESSAGE_CHARS * 8).
const MAX_CHAT_MESSAGE_CHARS = 4000;

const SIGNED_OUT = "Sign in to do that.";
const NO_ACCOUNT = "Accounts are not available right now.";

/**
 * Run one account call as the signed-in user.
 *
 * Server actions are public POST endpoints that skip middleware, so the session
 * is read here on every call and the user id comes from it alone. Nothing a
 * client sends is ever used to decide whose data this touches.
 */
async function asUser<T>(call: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  const session = await auth();
  if (!session?.user) return { ok: false, message: SIGNED_OUT };
  const userId = session.user.userId;
  if (!userId) return { ok: false, message: NO_ACCOUNT };
  try {
    return { ok: true, data: await call(userId) };
  } catch (error) {
    if (error instanceof AccountApiError && error.status === 404) {
      return retryAsReregistered(call, userId);
    }
    if (error instanceof AccountApiError) return { ok: false, message: error.message };
    return { ok: false, message: NO_ACCOUNT };
  }
}

/**
 * The session names an account the API has no row for. Register again and
 * retry once, so a signed-in visitor is never stranded behind a stale id with
 * no way out but signing out and back in.
 */
async function retryAsReregistered<T>(
  call: (userId: string) => Promise<T>,
  staleUserId: string
): Promise<ActionResult<T>> {
  try {
    const refreshed = await refreshSession({});
    const userId = refreshed?.user?.userId;
    if (!userId || userId === staleUserId) return { ok: false, message: NO_ACCOUNT };
    return { ok: true, data: await call(userId) };
  } catch (error) {
    if (error instanceof AccountApiError) return { ok: false, message: error.message };
    return { ok: false, message: NO_ACCOUNT };
  }
}

export async function getProfileAction(): Promise<ActionResult<AccountProfile>> {
  return asUser((userId) => fetchProfile(userId));
}

export async function getPickSheetAction(): Promise<ActionResult<PickSheet>> {
  return asUser((userId) => fetchPickSheet(userId));
}

export async function savePickAction(
  gameId: string,
  teamId: string,
  stake: number | null
): Promise<ActionResult<PickSheet>> {
  if (typeof gameId !== "string" || typeof teamId !== "string") {
    return { ok: false, message: "That pick could not be read." };
  }
  if (stake !== null && (!Number.isInteger(stake) || stake < 1 || stake > MAX_STAKE)) {
    return { ok: false, message: `A stake is whole dollars, from $1 to $${MAX_STAKE}.` };
  }
  return asUser((userId) => savePick(userId, gameId, { teamId, stake }));
}

export async function removePickAction(gameId: string): Promise<ActionResult<PickSheet>> {
  if (typeof gameId !== "string") {
    return { ok: false, message: "That pick could not be read." };
  }
  return asUser((userId) => deletePick(userId, gameId));
}

export async function chatAction(
  messages: ChatTurn[],
  season?: string
): Promise<ActionResult<ChatReply>> {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, message: "Ask a question first." };
  }
  // Rebuilt field by field: the argument is whatever a client chose to post.
  // Cut to what the API accepts per message, because a model answer can be
  // longer than that and would otherwise fail every follow-up after it.
  const turns: ChatTurn[] = messages.map((message) => ({
    role: message?.role === "assistant" ? "assistant" : "user",
    content: String(message?.content ?? "").slice(0, MAX_CHAT_MESSAGE_CHARS),
  }));
  return asUser((userId) => sendChat(userId, turns, typeof season === "string" ? season : ""));
}

/**
 * Delete the account and everything stored against it, then end the session.
 *
 * Neither this nor signOutAction redirects. The caller follows up with a full
 * page load, which is what drops the session, picks and quota the browser has
 * cached; a soft redirect would leave the header showing the old name.
 */
export async function deleteAccountAction(): Promise<ActionResult<null>> {
  const result = await asUser(async (userId) => {
    await deleteAccount(userId);
    return null;
  });
  if (result.ok) await signOut({ redirect: false });
  return result;
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirect: false });
}
