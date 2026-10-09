import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `isAdminUser` is covered directly in admin-access.test.ts. What is tested
 * here is the wiring around it. Sign-in is open to anyone now, so the two
 * things that must hold are that `authorized` is still the admin gate, and
 * that the session carries exactly the fields that gate reads. A callback
 * quietly returning true would hand the console to every visitor with a
 * Google account while every allowlist test stayed green.
 */
const captured = vi.hoisted(() => ({ config: null as Record<string, never> | null }));
const register = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({
  default: (config: Record<string, never>) => {
    captured.config = config;
    return { handlers: {}, auth: () => {}, signIn: () => {}, signOut: () => {} };
  },
}));
vi.mock("next-auth/providers/github", () => ({ default: { id: "github" } }));
vi.mock("next-auth/providers/google", () => ({ default: { id: "google" } }));
vi.mock("@/lib/account-api", () => ({ registerAccount: register }));

type Token = Record<string, unknown>;
type SessionUser = {
  provider?: string;
  login?: string;
  email?: string;
  verifiedEmail?: boolean;
  userId?: string;
  isAdmin?: boolean;
};
type Callbacks = {
  signIn?: unknown;
  jwt: (args: {
    token: Token;
    account?: { provider: string; providerAccountId: string } | null;
    profile?: Record<string, unknown>;
    trigger?: string;
  }) => Promise<Token>;
  session: (args: { session: { user?: SessionUser }; token: Token }) => { user?: SessionUser };
  authorized: (args: {
    auth: { user?: SessionUser } | null;
    request: { nextUrl: URL };
  }) => true | Response;
};

let callbacks: Callbacks;
const request = { nextUrl: new URL("https://baseline.test/admin/jobs?x=1") };

const github = { provider: "github", providerAccountId: "4821" };
const google = { provider: "google", providerAccountId: "109876" };

beforeAll(async () => {
  vi.stubEnv("ADMIN_GITHUB_LOGINS", "allowed-user");
  vi.stubEnv("ADMIN_GOOGLE_EMAILS", "owner@example.com");
  await import("@/auth");
  callbacks = (captured.config as unknown as { callbacks: Callbacks }).callbacks;
});

beforeEach(() => {
  register.mockReset();
  register.mockResolvedValue("user-uuid-1");
});

describe("auth config", () => {
  it("offers both providers and sends sign-in to the public page", () => {
    const config = captured.config as unknown as {
      providers: { id: string }[];
      pages: Record<string, string>;
    };
    expect(config.providers.map((provider) => provider.id)).toEqual(["github", "google"]);
    expect(config.pages.signIn).toBe("/signin");
    expect(config.pages.error).toBe("/signin");
  });

  it("has no signIn callback, so any account may hold a session", () => {
    // The allowlist used to live here. Leaving a stale one would lock the
    // public out; the admin check belongs to `authorized` alone.
    expect(callbacks.signIn).toBeUndefined();
  });
});

describe("jwt callback", () => {
  it("records a GitHub sign-in by login and registers the account", async () => {
    const token = await callbacks.jwt({
      token: { name: "Pat" },
      account: github,
      profile: { login: "allowed-user", email: "owner@example.com" },
    });
    expect(token).toMatchObject({
      provider: "github",
      subject: "4821",
      login: "allowed-user",
      verifiedEmail: false,
      userId: "user-uuid-1",
    });
    // The provider's account id identifies the user; no email is sent.
    expect(register).toHaveBeenCalledWith({
      provider: "github",
      subject: "4821",
      displayName: "Pat",
    });
  });

  it("records a Google sign-in with no login and only a verified address", async () => {
    const verified = await callbacks.jwt({
      token: {},
      account: google,
      profile: { email: "owner@example.com", email_verified: true, login: "spoofed" },
    });
    expect(verified).toMatchObject({ provider: "google", verifiedEmail: true });
    // A `login` field on a Google profile must never become an admin login.
    expect(verified.login).toBeUndefined();

    const unverified = await callbacks.jwt({
      token: {},
      account: google,
      profile: { email: "owner@example.com", email_verified: false },
    });
    expect(unverified.verifiedEmail).toBe(false);
    const stringly = await callbacks.jwt({
      token: {},
      account: google,
      profile: { email: "owner@example.com", email_verified: "true" },
    });
    expect(stringly.verifiedEmail).toBe(false);
  });

  it("signing in again replaces the identity instead of mixing two", async () => {
    const first = await callbacks.jwt({
      token: {},
      account: github,
      profile: { login: "allowed-user" },
    });
    register.mockResolvedValue("user-uuid-2");
    const second = await callbacks.jwt({
      token: first,
      account: google,
      profile: { email: "visitor@example.com", email_verified: true },
    });
    expect(second).toMatchObject({ provider: "google", subject: "109876", userId: "user-uuid-2" });
    expect(second.login).toBeUndefined();
  });

  it("leaves an established token alone on ordinary requests", async () => {
    const token = { provider: "github", subject: "4821", login: "x", userId: "user-uuid-9" };
    await expect(callbacks.jwt({ token: { ...token } })).resolves.toEqual(token);
    expect(register).not.toHaveBeenCalled();
  });

  it("still signs in when the account cannot be registered, and retries later", async () => {
    register.mockResolvedValue(undefined);
    const token = await callbacks.jwt({
      token: {},
      account: github,
      profile: { login: "allowed-user" },
    });
    // Admin access must not depend on the accounts API being up.
    expect(token).toMatchObject({ provider: "github", login: "allowed-user" });
    expect(token.userId).toBeUndefined();

    register.mockResolvedValue("user-uuid-3");
    const later = await callbacks.jwt({ token });
    expect(later.userId).toBe("user-uuid-3");
  });

  it("registers afresh when asked to, and only ever as the same identity", async () => {
    // What the server actions request when the API no longer knows the id.
    register.mockResolvedValue("user-uuid-new");
    const token = await callbacks.jwt({
      token: { provider: "github", subject: "4821", login: "x", userId: "user-uuid-gone" },
      trigger: "update",
    });
    expect(token.userId).toBe("user-uuid-new");
    // Keyed on the identity already in the token; nothing the caller sent.
    expect(register).toHaveBeenCalledWith({
      provider: "github",
      subject: "4821",
      displayName: undefined,
    });
    expect(token).toMatchObject({ provider: "github", subject: "4821", login: "x" });
  });

  it("does not try to register a token from before accounts existed", async () => {
    await callbacks.jwt({ token: { login: "allowed-user" } });
    expect(register).not.toHaveBeenCalled();
  });
});

describe("session callback", () => {
  it("exposes what the admin gate and account features read, and not the subject", () => {
    const session = callbacks.session({
      session: { user: { email: "owner@example.com" } },
      token: {
        provider: "google",
        subject: "109876",
        verifiedEmail: true,
        userId: "user-uuid-1",
      },
    });
    expect(session.user).toEqual({
      email: "owner@example.com",
      provider: "google",
      login: undefined,
      verifiedEmail: true,
      userId: "user-uuid-1",
      isAdmin: true,
    });
    expect(session.user).not.toHaveProperty("subject");
  });

  it("flags only the owner as admin, for the UI's benefit", () => {
    const visitor = callbacks.session({
      session: { user: { email: "visitor@example.com" } },
      token: { provider: "google", verifiedEmail: true, userId: "u" },
    });
    expect(visitor.user?.isAdmin).toBe(false);
    const owner = callbacks.session({
      session: { user: {} },
      token: { provider: "github", login: "allowed-user" },
    });
    expect(owner.user?.isAdmin).toBe(true);
    // The owner's address without Google's verification is not the owner.
    const unverified = callbacks.session({
      session: { user: { email: "owner@example.com" } },
      token: { provider: "google", verifiedEmail: false },
    });
    expect(unverified.user?.isAdmin).toBe(false);
  });

  it("does not dereference a signed-out session", () => {
    expect(callbacks.session({ session: {}, token: {} })).toEqual({});
  });
});

describe("authorized callback (the /admin gate)", () => {
  function denied(result: true | Response): string {
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(302);
    return response.headers.get("location") as string;
  }

  it("admits the owner by GitHub login or by verified Google address", () => {
    expect(
      callbacks.authorized({
        auth: { user: { provider: "github", login: "allowed-user" } },
        request,
      })
    ).toBe(true);
    expect(
      callbacks.authorized({
        auth: { user: { provider: "google", email: "owner@example.com", verifiedEmail: true } },
        request,
      })
    ).toBe(true);
  });

  it("sends an anonymous visitor to the admin sign-in page", () => {
    expect(denied(callbacks.authorized({ auth: null, request }))).toBe(
      "https://baseline.test/admin/signin"
    );
  });

  it("turns away a signed-in user who is not the owner, and says why", () => {
    const visitors: SessionUser[] = [
      { provider: "github", login: "stranger" },
      { provider: "google", email: "visitor@example.com", verifiedEmail: true },
      // The owner's address on an unverified Google account.
      { provider: "google", email: "owner@example.com", verifiedEmail: false },
      // The owner's address reported by a GitHub profile.
      { provider: "github", login: "stranger", email: "owner@example.com", verifiedEmail: true },
      // The owner's login claimed through Google.
      { provider: "google", login: "allowed-user", email: "x@example.com", verifiedEmail: true },
      // A session from before providers were recorded.
      { login: "allowed-user" },
    ];
    for (const user of visitors) {
      expect(denied(callbacks.authorized({ auth: { user }, request }))).toBe(
        "https://baseline.test/admin/signin?error=AccessDenied"
      );
    }
  });
});
