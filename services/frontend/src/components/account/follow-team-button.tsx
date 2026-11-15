"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { useProfile } from "@/hooks/use-profile";
import { useAccount } from "@/lib/account";

/**
 * Follow or unfollow a team. A signed-out visitor gets a sign-in link back to
 * this page instead, so the feature is visible before an account exists.
 */
export function FollowTeamButton({ teamId, teamName }: { teamId: string; teamName: string }) {
  const { account, isLoading } = useAccount();
  const { user, followedTeamIds, setTeamFollow } = useProfile();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  if (isLoading) return null;
  if (!account) {
    const returnTo = search ? `${pathname}?${search}` : pathname;
    return (
      <Link
        href={`/signin?callbackUrl=${encodeURIComponent(returnTo)}`}
        className="text-sm text-primary underline-offset-2 hover:underline"
      >
        Sign in to follow
      </Link>
    );
  }
  // Signed in, but the account could not be registered or has not loaded yet.
  if (!account.hasAccount || !user) return null;

  const following = followedTeamIds.has(teamId);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        className={following ? "btn-ghost" : "btn-fill"}
        aria-pressed={following}
        aria-label={following ? `Unfollow ${teamName}` : `Follow ${teamName}`}
        disabled={setTeamFollow.isPending}
        onClick={() => setTeamFollow.mutate({ teamId, following: !following })}
      >
        {following ? (
          <>
            Following <span aria-hidden>✓</span>
          </>
        ) : (
          "Follow"
        )}
      </button>
      {setTeamFollow.error ? (
        <span className="text-sm text-destructive" role="alert">
          {setTeamFollow.error.message}
        </span>
      ) : null}
    </span>
  );
}
