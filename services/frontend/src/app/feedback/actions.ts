"use server";

import { headers } from "next/headers";

import { auth } from "@/auth";
import { AccountApiError, submitFeedback } from "@/lib/account-api";
import {
  clientIpFrom,
  isFeedbackKind,
  MAX_FEEDBACK_CHARS,
  MIN_FEEDBACK_CHARS,
  parseFeedbackPage,
} from "@/lib/feedback";

export type FeedbackState =
  | { status: "idle" }
  | { status: "sent" }
  /** Switched off, or the API is not set up: the page offers the email address instead. */
  | { status: "off" }
  | { status: "error"; message: string };

const NOT_SENT = "That did not go through. Try again in a moment.";

/**
 * Send a report. Open to anyone, signed in or not.
 *
 * A server action is a public POST endpoint, so every field is re-checked
 * here; the API checks them again. The session only adds an account id to
 * the report: it grants nothing.
 */
export async function sendFeedbackAction(
  _previous: FeedbackState,
  formData: FormData
): Promise<FeedbackState> {
  const kind = formData.get("kind");
  const message = String(formData.get("message") ?? "").trim();
  const replyEmail = String(formData.get("reply_email") ?? "").trim();
  const website = String(formData.get("website") ?? "");

  if (!isFeedbackKind(kind)) {
    return { status: "error", message: "Choose what this is about." };
  }
  if (message.length < MIN_FEEDBACK_CHARS) {
    return { status: "error", message: "Say a little more about what you saw." };
  }
  if (message.length > MAX_FEEDBACK_CHARS) {
    return { status: "error", message: `Keep it under ${MAX_FEEDBACK_CHARS} characters.` };
  }

  const requestHeaders = await headers();
  // With no proxy header at all (local dev), every sender shares one bucket:
  // stricter than intended, never looser.
  const clientIp =
    clientIpFrom(requestHeaders.get("x-forwarded-for"), requestHeaders.get("x-real-ip")) ??
    "unknown";
  const session = await auth();

  try {
    await submitFeedback(
      {
        kind,
        message,
        reply_email: replyEmail || null,
        page_path: parseFeedbackPage(String(formData.get("page_path") ?? "")),
        website,
      },
      { clientIp, userId: session?.user?.userId }
    );
  } catch (error) {
    // The rate limits say something a visitor can act on.
    if (error instanceof AccountApiError && error.status === 429) {
      return { status: "error", message: error.message };
    }
    // The flag is off or the token is unset. The API's wording for the second
    // names configuration, so it is not passed through.
    if (error instanceof AccountApiError && error.status === 503) {
      return { status: "off" };
    }
    // Message and page are checked above, so a 422 is most likely the email.
    // The API counts characters differently (code points, not UTF-16), so
    // without an email the generic line is the honest one.
    if (error instanceof AccountApiError && error.status === 422 && replyEmail) {
      return { status: "error", message: "Check the email address and try again." };
    }
    return { status: "error", message: NOT_SENT };
  }
  return { status: "sent" };
}
