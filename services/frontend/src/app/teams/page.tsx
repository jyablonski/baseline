"use client";

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";

import { TeamRatingsScatter } from "@/components/charts/team-ratings-scatter";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamAbbrLink } from "@/components/team-logo";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import { formatGamesBack, formatRecord, formatWinPctPlain } from "@/lib/format";
import { teamHref, withSeason } from "@/lib/nav";
import { conferenceStandings, standingsSeed } from "@/lib/team-form";
import type { StandingRow } from "@/lib/types";
import { cn } from "@/lib/utils";

// Seeds 1-6 make the playoffs and 7-10 the play-in; a rule under each.
const CUT_LINES = [6, 10];

export default function TeamsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading teams…" />}>
      <TeamsDirectory />
    </Suspense>
  );
}

function TeamsDirectory() {
  const { season } = useSeason();

  const standingsQuery = useQuery({
    queryKey: ["standings", season],
    queryFn: () => api.listStandings({ season: season || undefined }),
  });
  // The scatter reads team ratings, which the standings rows do not carry.
  const teamsQuery = useQuery({
    queryKey: ["teams", season],
    queryFn: () => api.listTeams({ season: season || undefined }),
  });

  const rows = standingsQuery.data?.data ?? [];
  const east = conferenceStandings(rows, "east");
  const west = conferenceStandings(rows, "west");
  const teams = teamsQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-page">Teams</h1>
        <p className="mt-1 text-sm text-ink-2">
          Conference standings for {season || "the latest season"}. The top six make the playoffs;
          seeds 7 to 10 play in for the last two spots.
        </p>
      </div>

      {standingsQuery.isLoading ? (
        <LoadingState label="Loading standings…" />
      ) : standingsQuery.isError ? (
        <ErrorState message={queryErrorMessage(standingsQuery.error)} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No standings yet"
          message={`No Regular Season games or official standings for ${season || "this season"}.`}
        />
      ) : (
        <div className="grid gap-x-10 gap-y-6 xl:grid-cols-2">
          <ConferenceTable title="Eastern Conference" rows={east} season={season} />
          <ConferenceTable title="Western Conference" rows={west} season={season} />
        </div>
      )}

      {teams.length > 0 ? <TeamRatingsScatter teams={teams} /> : null}
    </div>
  );
}

function ConferenceTable({
  title,
  rows,
  season,
}: {
  title: string;
  rows: StandingRow[];
  season: string;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className="type-eyebrow mb-3">{title}</h2>
      <div className="overflow-x-auto">
        <table className="data-table data-table-compact">
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th className="text-right">W-L</th>
              <th className="text-right">Win %</th>
              <th className="text-right">GB</th>
              <th>Streak</th>
              <th className="text-right">L10</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const seed = standingsSeed(row);
              return (
                <tr
                  key={`${row.team_id}-${row.season}-${row.season_type}`}
                  // A heavier rule under the last playoff seed and the last play-in seed.
                  className={cn(
                    seed != null &&
                      CUT_LINES.includes(seed) &&
                      seed < rows.length &&
                      "border-b-rule-strong"
                  )}
                >
                  <td className="tabular text-muted-foreground">{seed ?? "—"}</td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <TeamAbbrLink
                        teamId={row.team_id}
                        abbreviation={row.abbreviation}
                        href={withSeason(teamHref(row.team_name), season)}
                      />
                      <span className="hidden text-muted-foreground sm:inline">
                        {row.team_name}
                      </span>
                    </span>
                  </td>
                  <td className="tabular text-right">{formatRecord(row.wins, row.losses)}</td>
                  <td className="tabular text-right">{formatWinPctPlain(row.win_pct)}</td>
                  <td className="tabular text-right">{formatGamesBack(row.games_back)}</td>
                  <td>{row.streak ?? "—"}</td>
                  <td className="tabular text-right">{row.last_10 ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
