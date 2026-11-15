"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { TeamLogo } from "@/components/team-logo";
import { useProfile } from "@/hooks/use-profile";
import { api } from "@/lib/api";
import { moveOne, searchTeams } from "@/lib/follows";
import { teamHref } from "@/lib/nav";

/**
 * Account › Teams you follow: add by search, set the order their header
 * shortcuts appear in, and unfollow.
 */
export function FollowedTeamsEditor() {
  const { follows, followedTeamIds, setTeamFollow, setFollowOrder } = useProfile();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const teams = follows.filter((follow) => follow.entity_type === "team");

  // Shared with the team page's lookup, so either fills the other's cache.
  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: () => api.listTeams() });
  const matches = searchTeams(teamsQuery.data?.data ?? [], query, followedTeamIds);
  const busy = setTeamFollow.isPending || setFollowOrder.isPending;
  const error = setTeamFollow.error ?? setFollowOrder.error;

  const follow = (teamId: string) =>
    setTeamFollow.mutate({ teamId, following: true }, { onSuccess: () => setQuery("") });
  const move = (index: number, step: -1 | 1) =>
    setFollowOrder.mutate(moveOne(teams, index, step).map((team) => team.entity_id));

  return (
    <section className="space-y-3 border-t border-rule pt-[var(--ct-space-4)]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="type-module">Teams you follow</h2>
        <span className="text-sm text-ink-2">
          {teams.length} {teams.length === 1 ? "team" : "teams"}
        </span>
      </div>
      <p className="text-sm text-ink-2">
        Their logos sit in the header in this order, and the schedule can show only them.
      </p>

      <div className="relative">
        <input
          type="search"
          aria-label="Add a team"
          placeholder="Add a team: search by city, name or abbreviation"
          className="h-[var(--ct-control-page)] w-full border border-foreground bg-field px-3 text-sm"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0] && !busy) {
              event.preventDefault();
              follow(matches[0].team_id);
            }
            if (event.key === "Escape") setQuery("");
          }}
        />
        {open && query.trim() ? (
          <ul
            aria-label="Matching teams"
            className="absolute inset-x-0 top-full z-10 border border-t-0 border-foreground bg-background"
          >
            {matches.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-2">
                No team you don&apos;t follow matches.
              </li>
            ) : (
              matches.map((team) => (
                <li key={team.team_id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-row-hover"
                    disabled={busy}
                    // Keep focus in the box, so blur doesn't close the list before the click lands.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => follow(team.team_id)}
                  >
                    <TeamLogo teamId={team.team_id} abbreviation={team.abbreviation} />
                    <span className="w-10 font-semibold">{team.abbreviation}</span>
                    <span>{team.team_name}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      {teams.length === 0 ? (
        <p className="border-t border-rule-strong pt-3 text-sm text-ink-2">
          You don&apos;t follow any teams yet.
        </p>
      ) : (
        <ol className="divide-y divide-rule-soft border-t border-rule-strong">
          {teams.map((team, index) => (
            <li
              key={team.entity_id}
              className="flex items-center gap-3 px-1 py-2 text-sm"
              data-testid="followed-team"
            >
              <span className="tabular w-5 text-right text-ink-3">{index + 1}</span>
              <TeamLogo teamId={team.entity_id} abbreviation={team.abbreviation ?? ""} />
              <span className="w-10 font-semibold">{team.abbreviation ?? "—"}</span>
              {team.name ? (
                <Link href={teamHref(team.name)} className="hover:underline">
                  {team.name}
                </Link>
              ) : (
                <span className="text-ink-2">No longer in the league</span>
              )}
              <span className="ml-auto inline-flex">
                <button
                  type="button"
                  className="h-8 w-8 border border-rule disabled:text-ink-3"
                  aria-label={`Move ${team.abbreviation ?? "this team"} up`}
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <span aria-hidden>↑</span>
                </button>
                <button
                  type="button"
                  className="-ml-px h-8 w-8 border border-rule disabled:text-ink-3"
                  aria-label={`Move ${team.abbreviation ?? "this team"} down`}
                  disabled={busy || index === teams.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <span aria-hidden>↓</span>
                </button>
              </span>
              <button
                type="button"
                className="ml-3 text-ink-2 underline underline-offset-2 hover:text-foreground"
                disabled={busy}
                aria-label={`Unfollow ${team.name ?? "this team"}`}
                onClick={() => setTeamFollow.mutate({ teamId: team.entity_id, following: false })}
              >
                Unfollow
              </button>
            </li>
          ))}
        </ol>
      )}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
    </section>
  );
}
