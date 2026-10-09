"use client";

import { useState } from "react";
import Link from "next/link";

import { deleteAccountAction } from "@/app/account/actions";
import { SignInPrompt } from "@/components/account/sign-in-prompt";
import { LoadingState } from "@/components/query-state";
import { useAccount } from "@/lib/account";
import { reloadHome, signOutAndReload } from "@/lib/sign-out";

export default function AccountPage() {
  const { account, isLoading } = useAccount();
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

          <section className="space-y-2 border-t border-rule pt-[var(--ct-space-4)]">
            <h2 className="type-module">What Baseline keeps</h2>
            <p className="text-sm text-ink-2">
              Your display name and an account id from the provider you signed in with, your picks,
              and a count of the questions you ask in chat. Your email address and the text of your
              chat questions are not stored. Chat questions may be sent to a third-party model
              provider to be answered.
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
