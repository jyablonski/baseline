/**
 * Admin allowlist. Kept out of auth.ts so it can be unit tested without
 * initialising NextAuth (which needs AUTH_SECRET and the GitHub credentials).
 */
export function allowedLogins(raw = process.env.ADMIN_GITHUB_LOGINS): string[] {
  return (raw ?? "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Fails closed. With ADMIN_GITHUB_LOGINS unset the allowlist is empty and
 * every account is rejected, including the owner's: an admin console that
 * accepts any GitHub user because a variable is missing is far worse than one
 * nobody can reach.
 */
export function isAllowedLogin(
  login: string | null | undefined,
  raw = process.env.ADMIN_GITHUB_LOGINS
): boolean {
  if (!login) return false;
  const allowed = allowedLogins(raw);
  if (allowed.length === 0) return false;
  return allowed.includes(login.toLowerCase());
}

/**
 * Whether the job buttons may queue work. Only the prod overlay sets this:
 * elsewhere nothing drains source.admin_jobs, and the runner only knows prod
 * targets, so a queued job would sit there and block the queue.
 */
export function adminJobsEnabled(raw = process.env.ADMIN_JOBS_ENABLED): boolean {
  return raw === "true";
}
