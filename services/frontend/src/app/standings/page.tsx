"use client";

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamAbbrLink } from "@/components/team-logo";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import { formatGamesBack, formatRecord, formatWinPctPlain } from "@/lib/format";
import { teamHref } from "@/lib/nav";
import { standingsSeed } from "@/lib/team-form";
import type { StandingRow } from "@/lib/types";

export default function StandingsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading standings…" />}>
      <StandingsBody />
    </Suspense>
  );
}

function StandingsBody() {
  const { season } = useSeason();

  const standingsQuery = useQuery({
    queryKey: ["standings", season],
    queryFn: () => api.listStandings({ season: season || undefined }),
  });

  const rows = standingsQuery.data?.data ?? [];
  const east = rows.filter((row) => row.conference.toLowerCase().startsWith("east")).sort(byRank);
  const west = rows.filter((row) => row.conference.toLowerCase().startsWith("west")).sort(byRank);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-page">Standings</h1>
          <p className="mt-1 text-sm text-ink-2">
            Conference rank, record, games behind, streak, and last-10 for{" "}
            {season || "the latest season"}.
          </p>
        </div>
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
        <div className="grid gap-10 lg:grid-cols-2">
          <ConferenceTable title="Eastern Conference" rows={east} />
          <ConferenceTable title="Western Conference" rows={west} />
        </div>
      )}
    </div>
  );
}

function ConferenceTable({ title, rows }: { title: string; rows: StandingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="type-eyebrow mb-3">{title}</h2>
      <table className="data-table">
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
          {rows.map((row) => (
            <tr key={`${row.team_id}-${row.season}-${row.season_type}`}>
              <td className="tabular text-muted-foreground">{standingsSeed(row) ?? "—"}</td>
              <td>
                <span className="inline-flex items-center gap-2">
                  <TeamAbbrLink
                    teamId={row.team_id}
                    abbreviation={row.abbreviation}
                    href={teamHref(row.team_name)}
                  />
                  <span className="text-muted-foreground">{row.team_name}</span>
                </span>
              </td>
              <td className="tabular text-right">{formatRecord(row.wins, row.losses)}</td>
              <td className="tabular text-right">{formatWinPctPlain(row.win_pct)}</td>
              <td className="tabular text-right">{formatGamesBack(row.games_back)}</td>
              <td>{row.streak ?? "—"}</td>
              <td className="tabular text-right">{row.last_10 ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function byRank(a: StandingRow, b: StandingRow) {
  const seedA = standingsSeed(a);
  const seedB = standingsSeed(b);
  if (seedA != null && seedB != null) {
    return seedA - seedB || a.team_name.localeCompare(b.team_name);
  }
  if (seedA != null) return -1;
  if (seedB != null) return 1;
  const winDiff = (b.win_pct ?? -1) - (a.win_pct ?? -1);
  if (winDiff !== 0) return winDiff;
  return a.team_name.localeCompare(b.team_name);
}
