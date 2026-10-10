import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AccountApiError,
  deleteAccount,
  deletePick,
  fetchPickSheet,
  fetchProfile,
  registerAccount,
  savePick,
  saveTimezone,
  sendChat,
} from "@/lib/account-api";

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<FetchMock>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ACCOUNTS_API_TOKEN", "server-secret");
  vi.stubEnv("ACCOUNTS_API_URL", "http://api:8000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

describe("registerAccount", () => {
  it("posts the provider identity with the server token and returns the id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { user_id: "u-1" } }));
    await expect(
      registerAccount({ provider: "github", subject: "4821", displayName: "Pat" })
    ).resolves.toBe("u-1");
    const { url, init, headers } = lastCall();
    expect(url).toBe("http://api:8000/api/v1/account/users");
    expect(init.method).toBe("POST");
    expect(headers.Authorization).toBe("Bearer server-secret");
    // No user exists yet, so no identity header is claimed.
    expect(headers).not.toHaveProperty("X-Baseline-User");
    expect(JSON.parse(init.body as string)).toEqual({
      provider: "github",
      provider_subject: "4821",
      display_name: "Pat",
    });
  });

  it("trims an over-long name and sends null for a missing one", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ data: { user_id: "u-1" } }));
    await registerAccount({ provider: "google", subject: "1", displayName: "x".repeat(300) });
    expect(JSON.parse(lastCall().init.body as string).display_name).toHaveLength(100);
    await registerAccount({ provider: "google", subject: "1" });
    expect(JSON.parse(lastCall().init.body as string).display_name).toBeNull();
  });

  it("never throws: sign-in must survive the accounts API being away", async () => {
    vi.stubEnv("ACCOUNTS_API_TOKEN", "");
    await expect(registerAccount({ provider: "github", subject: "1" })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("ACCOUNTS_API_TOKEN", "server-secret");
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(registerAccount({ provider: "github", subject: "1" })).resolves.toBeUndefined();
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Accounts API is not configured." }, 503));
    await expect(registerAccount({ provider: "github", subject: "1" })).resolves.toBeUndefined();
  });
});

describe("user-scoped calls", () => {
  const sheet = { summary: { wins: 0 }, picks: [] };

  it("sends the caller's id on every request", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ data: sheet }));
    await fetchPickSheet("u-7");
    expect(lastCall().url).toBe("http://api:8000/api/v1/account/picks");
    expect(lastCall().headers["X-Baseline-User"]).toBe("u-7");

    await savePick("u-7", "game/1", { teamId: "team-1", stake: 25 });
    // Path segments are encoded, so a crafted id cannot reach another route.
    expect(lastCall().url).toBe("http://api:8000/api/v1/account/picks/game%2F1");
    expect(lastCall().init.method).toBe("PUT");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({
      picked_team_id: "team-1",
      stake: 25,
    });

    await deletePick("u-7", "g-1");
    expect(lastCall().init.method).toBe("DELETE");
    expect(lastCall().init.body).toBeUndefined();
  });

  it("reads the profile and deletes the account", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { chat: { remaining: 4 } } }));
    await expect(fetchProfile("u-7")).resolves.toEqual({ chat: { remaining: 4 } });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteAccount("u-7")).resolves.toBeUndefined();
    expect(lastCall().url).toBe("http://api:8000/api/v1/account/me");
    expect(lastCall().init.method).toBe("DELETE");
  });

  it("saves a time zone, or null to clear it", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ data: { timezone: "UTC" } }));
    await expect(saveTimezone("u-7", "UTC")).resolves.toEqual({ timezone: "UTC" });
    expect(lastCall().url).toBe("http://api:8000/api/v1/account/me/timezone");
    expect(lastCall().init.method).toBe("PUT");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ timezone: "UTC" });
    await saveTimezone("u-7", null);
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ timezone: null });
  });

  it("sends the conversation and season to chat", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ answer: "ok", data: [] }));
    await sendChat("u-7", [{ role: "user", content: "hi" }], "2025-26");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({
      messages: [{ role: "user", content: "hi" }],
      season: "2025-26",
    });
    await sendChat("u-7", [{ role: "user", content: "hi" }]);
    expect(JSON.parse(lastCall().init.body as string).season).toBeNull();
  });
});

describe("failures", () => {
  it("fails closed without a token, before any request", async () => {
    vi.stubEnv("ACCOUNTS_API_TOKEN", "");
    await expect(fetchPickSheet("u-7")).rejects.toMatchObject({
      name: "AccountApiError",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the API's own message and its status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Picks for this game are locked." }, 409));
    const error = await savePick("u-7", "g", { teamId: "t", stake: null }).catch((e) => e);
    expect(error).toBeInstanceOf(AccountApiError);
    expect(error.message).toBe("Picks for this game are locked.");
    expect(error.status).toBe(409);
  });

  it("hides anything that is not a plain message", async () => {
    // A 422 validation array would otherwise be dumped on the page.
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: [{ loc: ["body"], msg: "bad" }] }, 422));
    await expect(fetchPickSheet("u-7")).rejects.toThrow("Accounts are not available right now.");
    fetchMock.mockResolvedValueOnce(new Response("<html>502</html>", { status: 502 }));
    await expect(fetchPickSheet("u-7")).rejects.toThrow("Accounts are not available right now.");
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED 10.0.0.4:8000"));
    await expect(fetchPickSheet("u-7")).rejects.toMatchObject({
      message: "Accounts are not available right now.",
      status: 0,
    });
  });

  it("falls back through the internal URLs to localhost", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ data: {} }));
    vi.stubEnv("ACCOUNTS_API_URL", "");
    vi.stubEnv("ADMIN_API_URL", "http://admin-api:8000");
    await fetchPickSheet("u");
    expect(lastCall().url.startsWith("http://admin-api:8000/")).toBe(true);
    vi.stubEnv("ADMIN_API_URL", "");
    vi.stubEnv("INTERNAL_API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    await fetchPickSheet("u");
    expect(lastCall().url.startsWith("http://localhost:8000/")).toBe(true);
  });
});
