import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The feedback action is open to anyone, so its checks are the only thing in
 * front of the API besides the API's own. The session may add an account id;
 * nothing a client sends decides it.
 */
const session = vi.hoisted(() => ({ current: null as { user?: { userId?: string } } | null }));
const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
const submit = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: async () => session.current }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.current }));
vi.mock("@/lib/account-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/account-api")>("@/lib/account-api");
  return { ...actual, submitFeedback: submit };
});

import { sendFeedbackAction } from "@/app/feedback/actions";
import { AccountApiError } from "@/lib/account-api";

const IDLE = { status: "idle" } as const;
const MESSAGE = "Curry's 3PA looks doubled on the Nov 3 game.";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.current = null;
  requestHeaders.current = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.2" });
  submit.mockResolvedValue(undefined);
});

describe("sendFeedbackAction", () => {
  it("sends an anonymous report with the first forwarded address", async () => {
    await expect(
      sendFeedbackAction(
        IDLE,
        form({
          kind: "data",
          message: `  ${MESSAGE}  `,
          reply_email: " fan@example.com ",
          page_path: "/data",
          website: "",
        })
      )
    ).resolves.toEqual({ status: "sent" });
    expect(submit).toHaveBeenCalledWith(
      {
        kind: "data",
        message: MESSAGE,
        reply_email: "fan@example.com",
        page_path: "/data",
        website: "",
      },
      { clientIp: "203.0.113.7", userId: undefined }
    );
  });

  it("credits a signed-in sender from the session alone", async () => {
    session.current = { user: { userId: "u-1" } };
    await sendFeedbackAction(IDLE, form({ kind: "bug", message: MESSAGE, userId: "u-2" }));
    expect(submit.mock.calls[0][1]).toEqual({ clientIp: "203.0.113.7", userId: "u-1" });
    expect(submit.mock.calls[0][0]).toMatchObject({ reply_email: null, page_path: null });
  });

  it("drops a page path that leaves the site", async () => {
    await sendFeedbackAction(
      IDLE,
      form({ kind: "bug", message: MESSAGE, page_path: "//evil.example" })
    );
    expect(submit.mock.calls[0][0].page_path).toBeNull();
  });

  it("passes the honeypot through for the API to drop", async () => {
    await sendFeedbackAction(IDLE, form({ kind: "bug", message: MESSAGE, website: "spam" }));
    expect(submit.mock.calls[0][0].website).toBe("spam");
  });

  it("shares one bucket when no proxy header arrives", async () => {
    requestHeaders.current = new Headers();
    await sendFeedbackAction(IDLE, form({ kind: "bug", message: MESSAGE }));
    expect(submit.mock.calls[0][1].clientIp).toBe("unknown");
  });

  it("refuses a bad kind or a message that is too short or too long", async () => {
    await expect(
      sendFeedbackAction(IDLE, form({ kind: "rant", message: MESSAGE }))
    ).resolves.toEqual({ status: "error", message: "Choose what this is about." });
    await expect(
      sendFeedbackAction(IDLE, form({ kind: "bug", message: "   short   " }))
    ).resolves.toEqual({ status: "error", message: "Say a little more about what you saw." });
    await expect(
      sendFeedbackAction(IDLE, form({ kind: "bug", message: "x".repeat(2001) }))
    ).resolves.toEqual({ status: "error", message: "Keep it under 2000 characters." });
    expect(submit).not.toHaveBeenCalled();
  });

  it("shows the rate limit, closes on 503, and hides anything else", async () => {
    const send = () => sendFeedbackAction(IDLE, form({ kind: "bug", message: MESSAGE }));

    submit.mockRejectedValueOnce(new AccountApiError("Try again a little later.", 429));
    await expect(send()).resolves.toEqual({
      status: "error",
      message: "Try again a little later.",
    });

    submit.mockRejectedValueOnce(new AccountApiError("Accounts API is not configured.", 503));
    await expect(send()).resolves.toEqual({ status: "off" });

    submit.mockRejectedValueOnce(new AccountApiError("Accounts are not available.", 422));
    await expect(
      sendFeedbackAction(IDLE, form({ kind: "bug", message: MESSAGE, reply_email: "me@example" }))
    ).resolves.toEqual({
      status: "error",
      message: "Check the email address and try again.",
    });

    // No email given: a 422 is about the message, so the generic line.
    submit.mockRejectedValueOnce(new AccountApiError("Accounts are not available.", 422));
    await expect(send()).resolves.toEqual({
      status: "error",
      message: "That did not go through. Try again in a moment.",
    });

    submit.mockRejectedValueOnce(new AccountApiError("Missing client address.", 400));
    await expect(send()).resolves.toEqual({
      status: "error",
      message: "That did not go through. Try again in a moment.",
    });

    submit.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(send()).resolves.toMatchObject({ status: "error" });
  });
});
