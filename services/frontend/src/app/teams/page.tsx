"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { TeamRatingsScatter } from "@/components/charts/team-ratings-scatter";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamAbbrLink } from "@/components/team-logo";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import { formatRecord, formatWinPctPlain } from "@/lib/format";
import { teamHref } from "@/lib/nav";
import type { TeamSummary } from "@/lib/types";

const EAST_DIVISIONS = ["Atlantic", "Central", "Southeast"];
const WEST_DIVISIONS = ["Pacific", "Northwest", "Southwest"];

export default function TeamsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading teams…" />}>
      <TeamsDirectory />
    </Suspense>
  );
}

function TeamsDirectory() {
  const { season } = useSeason();

  const teamsQuery = useQuery({
    queryKey: ["teams", season],
    queryFn: () => api.listTeams({ season: season || undefined }),
  });

  const teams = teamsQuery.data?.data ?? [];
  const east = teams.filter((team) => team.conference.toLowerCase().startsWith("east"));
  const west = teams.filter((team) => team.conference.toLowerCase().startsWith("west"));

  return (
    <div>
      <h1 className="type-page">Teams</h1>

      {teamsQuery.isLoading ? (
        <div className="mt-1">
          <LoadingState label="Loading teams…" />
        </div>
      ) : teamsQuery.isError ? (
        <div className="mt-1">
          <ErrorState message={queryErrorMessage(teamsQuery.error)} />
        </div>
      ) : teams.length === 0 ? (
        <div className="mt-1">
          <EmptyState message="No teams to show yet." />
        </div>
      ) : (
        <>
          <div className="mt-1 grid gap-10 lg:grid-cols-2">
            <ConferenceColumn title="Eastern Conference" teams={east} divisions={EAST_DIVISIONS} />
            <ConferenceColumn title="Western Conference" teams={west} divisions={WEST_DIVISIONS} />
          </div>
          <div className="mt-10">
            <TeamRatingsScatter teams={teams} />
          </div>
        </>
      )}
    </div>
  );
}

function ConferenceColumn({
  title,
  teams,
  divisions,
}: {
  title: string;
  teams: TeamSummary[];
  divisions: string[];
}) {
  const grouped = divisions
    .map((division) => ({
      division,
      teams: teams
        .filter((team) => team.division.toLowerCase() === division.toLowerCase())
        .sort(compareDivisionStandings),
    }))
    .filter((group) => group.teams.length > 0);
  const leftover = teams
    .filter(
      (team) =>
        !divisions.some((division) => team.division.toLowerCase() === division.toLowerCase())
    )
    .sort(compareDivisionStandings);
  if (leftover.length) grouped.push({ division: "Other", teams: leftover });

  return (
    <section>
      <h2 className="type-eyebrow mb-4">{title}</h2>
      <div className="space-y-5">
        {grouped.map((group) => (
          <div key={group.division}>
            <p className="mb-1 text-xs text-muted-foreground">{group.division}</p>
            <ul>
              {group.teams.map((team) => {
                const nickname =
                  team.nickname ?? team.team_name.replace(team.city ?? "", "").trim();
                return (
                  <li
                    key={team.team_id}
                    className="grid grid-cols-[auto_1fr_auto_3.5rem] items-center gap-2 border-b border-border py-1.5 text-sm hover:bg-row-hover"
                  >
                    <TeamAbbrLink
                      teamId={team.team_id}
                      abbreviation={team.abbreviation}
                      href={teamHref(team.team_name)}
                    />
                    <Link href={teamHref(team.team_name)} className="hover:text-primary">
                      {nickname || team.team_name}
                    </Link>
                    <span className="tabular text-muted-foreground">
                      {formatRecord(team.wins, team.losses)}
                    </span>
                    <span className="tabular text-right">{formatWinPctPlain(team.win_pct)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function compareNullableRank(a: number | null | undefined, b: number | null | undefined) {
  if (a != null && b != null) return a - b;
  if (a != null) return -1;
  if (b != null) return 1;
  return null;
}

function compareDivisionStandings(a: TeamSummary, b: TeamSummary) {
  const divisionRank = compareNullableRank(a.division_rank, b.division_rank);
  if (divisionRank != null) return divisionRank || a.team_name.localeCompare(b.team_name);
  const conferenceRank = compareNullableRank(a.conference_rank, b.conference_rank);
  if (conferenceRank != null) return conferenceRank || a.team_name.localeCompare(b.team_name);
  const winPct = (b.win_pct ?? -1) - (a.win_pct ?? -1);
  if (winPct !== 0) return winPct;
  const wins = (b.wins ?? -1) - (a.wins ?? -1);
  if (wins !== 0) return wins;
  const losses = (a.losses ?? Number.POSITIVE_INFINITY) - (b.losses ?? Number.POSITIVE_INFINITY);
  if (losses !== 0) return losses;
  return a.team_name.localeCompare(b.team_name);
}
