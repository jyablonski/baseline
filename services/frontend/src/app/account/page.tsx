"use client";

import { useState } from "react";
import Link from "next/link";

import { deleteAccountAction } from "@/app/account/actions";
import { SignInPrompt } from "@/components/account/sign-in-prompt";
import { LoadingState } from "@/components/query-state";
import { useProfile } from "@/hooks/use-profile";
import { useAccount } from "@/lib/account";
import { reloadHome, signOutAndReload } from "@/lib/sign-out";
import { DEFAULT_TIMEZONE, TIMEZONES } from "@/lib/timezones";

export default function AccountPage() {
  const { account, isLoading } = useAccount();
  const { user, timezone, setTimezone } = useProfile();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    await signOutAndReload();
  }

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    const result = await deleteAccountAction();
    if (result.ok) {
      reloadHome();
      return;
    }
    setError(result.message);
    setBusy(false);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="type-page">Account</h1>
      </header>

      {isLoading ? (
        <LoadingState label="Loading account…" />
      ) : !account ? (
        <SignInPrompt returnTo="/account">You are not signed in.</SignInPrompt>
      ) : (
        <>
          <section className="space-y-3">
            <p className="text-sm">
              Signed in as <span className="font-semibold">{account.name || "your account"}</span>.
            </p>
            {user ? (
              <p className="text-sm text-ink-2" data-testid="member-since">
                Member since{" "}
                {new Date(user.created_at).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  timeZone: timezone ?? DEFAULT_TIMEZONE,
                })}
              </p>
            ) : null}
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </section>

          {account.isAdmin ? (
            <section className="space-y-2 border-t border-rule pt-[var(--ct-space-4)]">
              <h2 className="type-module">Admin</h2>
              <p className="text-sm text-ink-2">
                Ingestion, dbt and ML health, and the feature flags.
              </p>
              <Link href="/admin" className="btn-ghost">
                Open admin →
              </Link>
            </section>
          ) : null}

          {user ? (
            <section className="space-y-2 border-t border-rule pt-[var(--ct-space-4)]">
              <h2 className="type-module">
                <label htmlFor="timezone">Time zone</label>
              </h2>
              <p className="text-sm text-ink-2">Game start times are shown in this time zone.</p>
              <select
                id="timezone"
                className="h-[var(--ct-control-page)] border border-input bg-field px-2 text-sm"
                value={timezone ?? DEFAULT_TIMEZONE}
                disabled={setTimezone.isPending}
                onChange={(event) =>
                  // Eastern is stored as "no choice", so the default can never drift.
                  setTimezone.mutate(
                    event.target.value === DEFAULT_TIMEZONE ? null : event.target.value
                  )
                }
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone.value} value={zone.value}>
                    {zone.label}
                  </option>
                ))}
              </select>
              {setTimezone.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {setTimezone.error.message}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-2 border-t border-rule pt-[var(--ct-space-4)]">
            <h2 className="type-module">What Baseline keeps</h2>
            <p className="text-sm text-ink-2">
              Your display name and an account id from the provider you signed in with, your picks,
              and your time zone setting. Your email address is not stored.
            </p>
          </section>

          <section className="space-y-3 border-t border-rule pt-[var(--ct-space-4)]">
            <h2 className="type-module">Delete account</h2>
            <p className="text-sm text-ink-2">
              Removes your account, your picks and your usage history. This cannot be undone.
            </p>
            {confirming ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-fill"
                  disabled={busy}
                  onClick={() => void deleteAccount()}
                >
                  {busy ? "Deleting…" : "Yes, delete everything"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="btn-ghost" onClick={() => setConfirming(true)}>
                Delete my account
              </button>
            )}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
