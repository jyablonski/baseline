import { safeReturnPath } from "@/lib/return-path";

export type FeedbackKind = "data" | "bug" | "idea" | "other";

/** The API's bounds (services/api/src/schemas/feedback.py). */
export const MIN_FEEDBACK_CHARS = 10;
export const MAX_FEEDBACK_CHARS = 2000;
const MAX_PAGE_PATH_CHARS = 512;

export const FEEDBACK_KINDS: { value: FeedbackKind; label: string }[] = [
  { value: "data", label: "A wrong number" },
  { value: "bug", label: "Something is broken" },
  { value: "idea", label: "An idea" },
  { value: "other", label: "Something else" },
];

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return FEEDBACK_KINDS.some((kind) => kind.value === value);
}

/** `?kind=` is user-editable, so anything unknown falls back to "other". */
export function parseFeedbackKind(value: string | string[] | undefined): FeedbackKind {
  const kind = Array.isArray(value) ? value[0] : value;
  return isFeedbackKind(kind) ? kind : "other";
}

/**
 * The page a report is about, from `?from=`. Same-site paths only: the admin
 * page links to it, so `//evil.example` must never be stored.
 */
export function parseFeedbackPage(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const path = safeReturnPath(raw);
  return path === "/" && raw !== "/" ? null : path.slice(0, MAX_PAGE_PATH_CHARS);
}

/**
 * The visitor's address, from the header Caddy sets on its hop to Next.js.
 *
 * Caddy replaces any X-Forwarded-For a client sends (no trusted_proxies), so
 * the first entry is the real peer. If a CDN is ever put in front, this is
 * the line that has to change.
 */
export function clientIpFrom(forwardedFor: string | null, realIp: string | null): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || realIp?.trim() || null;
}

export function feedbackHref(kind: FeedbackKind, from?: string): string {
  const params = new URLSearchParams({ kind });
  if (from) params.set("from", from);
  return `/feedback?${params}`;
}
