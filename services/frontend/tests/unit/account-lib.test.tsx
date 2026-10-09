import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const features = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { getFeatures: features.get } }));

import { SignInPrompt } from "@/components/account/sign-in-prompt";
import { Providers } from "@/components/providers";
import { fetchAccountSession, useAccount, useFeatures } from "@/lib/account";
import { safeReturnPath } from "@/lib/return-path";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  features.get.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function sessionResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("fetchAccountSession", () => {
  it("reads the name and whether an account exists", async () => {
    fetchMock.mockResolvedValue(sessionResponse({ user: { name: "Pat", userId: "u-1" } }));
    await expect(fetchAccountSession()).resolves.toEqual({
      name: "Pat",
      hasAccount: true,
      isAdmin: false,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", { cache: "no-store" });

    fetchMock.mockResolvedValue(sessionResponse({ user: {} }));
    await expect(fetchAccountSession()).resolves.toEqual({
      name: null,
      hasAccount: false,
      isAdmin: false,
    });
    // Only a literal true counts.
    fetchMock.mockResolvedValue(sessionResponse({ user: { isAdmin: "yes" } }));
    await expect(fetchAccountSession()).resolves.toMatchObject({ isAdmin: false });
    fetchMock.mockResolvedValue(sessionResponse({ user: { isAdmin: true } }));
    await expect(fetchAccountSession()).resolves.toMatchObject({ isAdmin: true });
  });

  it("treats every failure as signed out", async () => {
    // NextAuth answers a signed-out visitor with a literal null.
    fetchMock.mockResolvedValue(sessionResponse(null));
    await expect(fetchAccountSession()).resolves.toBeNull();
    fetchMock.mockResolvedValue(sessionResponse({}));
    await expect(fetchAccountSession()).resolves.toBeNull();
    fetchMock.mockResolvedValue(sessionResponse({ message: "boom" }, 500));
    await expect(fetchAccountSession()).resolves.toBeNull();
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(fetchAccountSession()).resolves.toBeNull();
  });
});

function Probe() {
  const { account, isLoading } = useAccount();
  const flags = useFeatures();
  return (
    <p>
      {isLoading || flags.isLoading
        ? "loading"
        : `${account?.name ?? "anonymous"} chatbot=${flags.chatbot} picks=${flags.picks}`}
    </p>
  );
}

describe("useAccount and useFeatures", () => {
  it("report the session and the flags that are on", async () => {
    fetchMock.mockResolvedValue(sessionResponse({ user: { name: "Pat", userId: "u-1" } }));
    features.get.mockResolvedValue({ chatbot: true, picks: false });
    render(
      <Providers>
        <Probe />
      </Providers>
    );
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findByText("Pat chatbot=true picks=false")).toBeInTheDocument();
  });

  it("leave every feature off when the flags cannot be read", async () => {
    fetchMock.mockResolvedValue(sessionResponse(null));
    features.get.mockRejectedValue(new Error("down"));
    render(
      <Providers>
        <Probe />
      </Providers>
    );
    await waitFor(() =>
      expect(screen.getByText("anonymous chatbot=false picks=false")).toBeInTheDocument()
    );
  });

  it("treat a flag that is missing or not exactly true as off", async () => {
    fetchMock.mockResolvedValue(sessionResponse(null));
    features.get.mockResolvedValue({ chatbot: "yes" });
    render(
      <Providers>
        <Probe />
      </Providers>
    );
    expect(await screen.findByText("anonymous chatbot=false picks=false")).toBeInTheDocument();
  });
});

describe("safeReturnPath", () => {
  it("keeps a same-site path", () => {
    expect(safeReturnPath("/picks")).toBe("/picks");
    expect(safeReturnPath("/schedule?season=2026-27")).toBe("/schedule?season=2026-27");
  });

  it("sends anything that could leave the site back to the home page", () => {
    for (const value of [
      null,
      undefined,
      "",
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "picks",
    ]) {
      expect(safeReturnPath(value)).toBe("/");
    }
  });
});

describe("SignInPrompt", () => {
  it("links to sign-in and back to where the visitor was", () => {
    render(<SignInPrompt returnTo="/schedule?season=2026-27">Sign in to pick.</SignInPrompt>);
    expect(screen.getByText("Sign in to pick.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/signin?callbackUrl=%2Fschedule%3Fseason%3D2026-27"
    );
  });
});
