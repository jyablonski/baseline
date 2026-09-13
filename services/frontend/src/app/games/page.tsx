"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { api, queryErrorMessage } from "@/lib/api";
import { formatDate, formatSignedMargin } from "@/lib/format";
import { periodLabel } from "@/lib/game-flow";
import { cn } from "@/lib/utils";
import type { GameCollapse, LeagueGame } from "@/lib/types";

export default function GamesPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading games…" />}>
      <GamesIndex />
    </Suspense>
  );
}

function GamesIndex() {
  const gamesQuery = useQuery({
    queryKey: ["games", "recent-finals"],
    queryFn: () => api.listGames({ limit: 15 }),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="type-eyebrow">Recent final games</p>
        <h1 className="type-page">Game flow</h1>
        <p className="mt-1 text-sm text-ink-2">
          Scoring-play differential from PBP. Not live win probability.
        </p>
      </div>
      {gamesQuery.isLoading ? (
        <LoadingState label="Loading recent games…" />
      ) : gamesQuery.isError ? (
        <ErrorState message={queryErrorMessage(gamesQuery.error)} />
      ) : (gamesQuery.data?.data ?? []).length === 0 ? (
        <EmptyState message="No completed games to show yet." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Matchup</th>
              <th>Score</th>
              <th>Margin</th>
              <th>PBP</th>
            </tr>
          </thead>
          <tbody>
            {(gamesQuery.data?.data ?? []).map((game) => (
              <GameIndexRow key={game.game_id} game={game} />
            ))}
          </tbody>
        </table>
      )}
      <BiggestCollapses />
    </div>
  );
}

function BiggestCollapses() {
  const [blownLeadTeam, setBlownLeadTeam] = useState("");
  // Same query key as the other directories, so this shares their cached list.
  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
  });
  // Filtered server-side: the unfiltered response is the league-wide top 10, so
  // narrowing it in the browser would almost always leave nothing.
  const collapsesQuery = useQuery({
    queryKey: ["games", "collapses", blownLeadTeam],
    queryFn: () =>
      api.listBiggestCollapses({ blown_lead_team: blownLeadTeam || undefined, limit: 10 }),
    // Keep the previous rows mounted while the next team loads. Swapping the
    // table for a spinner collapses document height mid-fetch, and the browser
    // clamps scrollTop to the shorter page — so changing the filter threw the
    // reader back up the page.
    placeholderData: keepPreviousData,
  });
  const collapses = collapsesQuery.data?.data ?? [];
  const teamOptions = useMemo(
    () =>
      [...(teamsQuery.data?.data ?? [])]
        .map((team) => team.abbreviation)
        .filter((abbreviation): abbreviation is string => Boolean(abbreviation))
        .sort((left, right) => left.localeCompare(right)),
    [teamsQuery.data]
  );

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="type-eyebrow">Collapse of the season</p>
          <h2 className="type-module">Biggest blown leads</h2>
          <p className="mt-1 text-sm text-ink-2">
            The largest lead a team held and still lost, from scoring PBP.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-2">Blew it</span>
          <select
            className={cn("field", blownLeadTeam && "field-query")}
            value={blownLeadTeam}
            onChange={(event) => setBlownLeadTeam(event.target.value)}
          >
            <option value="">Any team</option>
            {teamOptions.map((abbreviation) => (
              <option key={abbreviation} value={abbreviation}>
                {abbreviation}
              </option>
            ))}
          </select>
        </label>
      </div>
      {collapsesQuery.isLoading ? (
        <LoadingState label="Loading blown leads…" />
      ) : collapsesQuery.isError ? (
        <ErrorState message={queryErrorMessage(collapsesQuery.error)} />
      ) : collapses.length === 0 ? (
        <EmptyState
          message={
            blownLeadTeam
              ? `No blown leads for ${blownLeadTeam} yet.`
              : "No blown leads to show yet."
          }
        />
      ) : (
        <table
          className={cn("data-table", collapsesQuery.isFetching && "opacity-60")}
          aria-busy={collapsesQuery.isFetching}
        >
          <thead>
            <tr>
              <th>Date</th>
              <th>Blew it</th>
              <th>Opponent</th>
              <th>Lead</th>
              <th>Peaked</th>
              <th>Final</th>
              <th>PBP</th>
            </tr>
          </thead>
          <tbody>
            {collapses.map((collapse) => (
              <CollapseRow key={collapse.game_id} collapse={collapse} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** The team that came back, falling back to whichever side did not blow it. */
function opponentOf(collapse: GameCollapse): string {
  if (collapse.comeback_team_abbreviation) return collapse.comeback_team_abbreviation;
  const blew = collapse.blown_lead_team_abbreviation;
  if (!blew) return "—";
  if (blew === collapse.home_team_abbreviation) return collapse.away_team_abbreviation ?? "—";
  if (blew === collapse.away_team_abbreviation) return collapse.home_team_abbreviation ?? "—";
  return "—";
}

function CollapseRow({ collapse }: { collapse: GameCollapse }) {
  const away = collapse.away_team_abbreviation ?? "Away";
  const home = collapse.home_team_abbreviation ?? "Home";
  const score =
    collapse.away_score != null && collapse.home_score != null
      ? `${away} ${collapse.away_score}–${home} ${collapse.home_score}`
      : "—";
  const peaked = collapse.blown_lead_period != null ? periodLabel(collapse.blown_lead_period) : "—";
  return (
    <tr>
      <td className="tabular whitespace-nowrap">{formatDate(collapse.game_date)}</td>
      <td className="font-semibold">{collapse.blown_lead_team_abbreviation ?? "—"}</td>
      <td>{opponentOf(collapse)}</td>
      <td className="tabular font-semibold">{collapse.largest_lead_blown}</td>
      <td className="tabular whitespace-nowrap">{peaked}</td>
      <td className="tabular whitespace-nowrap">{score}</td>
      <td>
        <Link href={`/games/${collapse.game_id}`} className="text-primary hover:underline">
          PBP →
        </Link>
      </td>
    </tr>
  );
}

function GameIndexRow({ game }: { game: LeagueGame }) {
  const away = game.away_team_abbreviation ?? "Away";
  const home = game.home_team_abbreviation ?? "Home";
  const score =
    game.away_score != null && game.home_score != null
      ? `${game.away_score}–${game.home_score}`
      : "—";
  const margin = game.score_margin != null ? formatSignedMargin(game.score_margin) : "—";
  return (
    <tr>
      <td className="tabular whitespace-nowrap">{formatDate(game.game_date)}</td>
      <td>
        <span className="font-semibold">{away}</span>
        <span className="px-1 text-muted-foreground">at</span>
        <span className="font-semibold">{home}</span>
      </td>
      <td className="tabular font-semibold">{score}</td>
      <td className="tabular font-semibold">{margin}</td>
      <td>
        <Link href={`/games/${game.game_id}`} className="text-primary hover:underline">
          PBP →
        </Link>
      </td>
    </tr>
  );
}
