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

export function allowedEmails(raw = process.env.ADMIN_GOOGLE_EMAILS): string[] {
  return (raw ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/** The parts of a session the admin check reads. */
export type AdminIdentity = {
  provider?: string | null;
  login?: string | null;
  email?: string | null;
  verifiedEmail?: boolean | null;
};

/**
 * Whether a signed-in account is the site owner.
 *
 * Anyone can hold a session now, so this is the only thing that separates a
 * visitor from the operator. Each provider is matched on its own identifier
 * and nothing else: a GitHub account by login against ADMIN_GITHUB_LOGINS, a
 * Google account by verified address against ADMIN_GOOGLE_EMAILS. The email a
 * GitHub profile reports is never consulted, so adding an owner's address to
 * a GitHub account opens nothing. Both lists fail closed when unset.
 */
export function isAdminUser(
  user: AdminIdentity | null | undefined,
  env: { logins?: string; emails?: string } = {
    logins: process.env.ADMIN_GITHUB_LOGINS,
    emails: process.env.ADMIN_GOOGLE_EMAILS,
  }
): boolean {
  if (!user) return false;
  if (user.provider === "github") return isAllowedLogin(user.login, env.logins);
  if (user.provider === "google") {
    if (user.verifiedEmail !== true || !user.email) return false;
    return allowedEmails(env.emails).includes(user.email.toLowerCase());
  }
  return false;
}

/**
 * Whether the job buttons may queue work. Only the prod overlay sets this:
 * elsewhere nothing drains source.admin_jobs, and the runner only knows prod
 * targets, so a queued job would sit there and block the queue.
 */
export function adminJobsEnabled(raw = process.env.ADMIN_JOBS_ENABLED): boolean {
  return raw === "true";
}
