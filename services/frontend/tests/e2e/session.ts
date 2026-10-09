import { randomUUID } from "node:crypto";

import type { BrowserContext, Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

import { E2E, STUB_API_URL } from "./e2e-env";

// The cookie NextAuth sets over plain http, which is also the salt its JWT is
// encrypted with.
const SESSION_COOKIE = "authjs.session-token";

export type SessionIdentity = {
  provider: "github" | "google";
  name?: string;
  login?: string;
  email?: string;
  verifiedEmail?: boolean;
  /** Null leaves the account unregistered, as if the API was down at sign-in. */
  userId?: string | null;
  /** The session names an account id the API has no row for. */
  stale?: boolean;
};

/**
 * Sign a browser in without an OAuth round trip.
 *
 * GitHub and Google cannot be driven from a test, so this mints the session
 * cookie their callback would have set, encrypted with the dev server's own
 * AUTH_SECRET. Everything after that is real: middleware decrypts it, the
 * session callback shapes it, and the server actions read it.
 */
export async function signInAs(context: BrowserContext, identity: SessionIdentity) {
  const userId = identity.userId === undefined ? randomUUID() : identity.userId;
  const token = await encode({
    secret: E2E.authSecret,
    salt: SESSION_COOKIE,
    token: {
      name: identity.name ?? "Pat Tester",
      email: identity.email,
      sub: randomUUID(),
      provider: identity.provider,
      subject: randomUUID(),
      login: identity.login,
      verifiedEmail: identity.verifiedEmail ?? false,
      ...(userId ? { userId } : {}),
    },
  });
  if (userId && !identity.stale) await stub("/seed", { user_id: userId });
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return userId;
}

export const visitor = (overrides: Partial<SessionIdentity> = {}): SessionIdentity => ({
  provider: "google",
  email: "visitor@e2e.test",
  verifiedEmail: true,
  ...overrides,
});

export const githubOwner: SessionIdentity = { provider: "github", login: E2E.ownerLogin };
export const googleOwner: SessionIdentity = {
  provider: "google",
  email: E2E.ownerEmail,
  verifiedEmail: true,
};

type StubRequest = { method: string; path: string; user: string | null; body: unknown };

async function stub(path: string, body?: unknown) {
  const response = await fetch(`${STUB_API_URL}/__stub${path}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json();
}

export const resetStub = () => stub("/reset", {});
export const blockUser = (userId: string) => stub("/block", { user_id: userId });
export const stubRequests = (): Promise<StubRequest[]> => stub("/requests");

export function accountNav(page: Page) {
  return page.getByRole("navigation", { name: "Account" });
}
