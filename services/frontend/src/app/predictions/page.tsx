"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";

import { ColumnHelp } from "@/components/column-help";
import { PageNav } from "@/components/page-nav";
import { BaselineRows } from "@/components/predictions/baseline-rows";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamSelect } from "@/components/team-select";
import { KpiCard, KpiStrip, KpiTitle } from "@/components/ui/kpi-card";
import { api, queryErrorMessage } from "@/lib/api";
import { formatNumber, formatProbability, formatShortDate } from "@/lib/format";
import { weightLines } from "@/lib/model-breakdown";
import { latestSeason, marketComparison, modelCall, modelLabel } from "@/lib/predictions";
import type { CalibrationBucket, PredictionGame, ScorecardRow } from "@/lib/types";
import { cn } from "@/lib/utils";

const CALLS_PAGE = 10;

export default function PredictionsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading the model's record…" />}>
      <Predictions />
    </Suspense>
  );
}

function Predictions() {
  const scorecardQuery = useQuery({
    queryKey: ["prediction-scorecard"],
    queryFn: () => api.getPredictionScorecard(),
  });
  const live = latestSeason(scorecardQuery.data?.rows ?? []).find((row) => row.is_champion);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="type-page">How accurate is the model?</h1>
        <p className="mt-1 text-ink-2">
          {live ? `${modelLabel(live)} sets` : "Our pregame model sets"} the win % on the{" "}
          <Link href="/schedule" className="underline underline-offset-2">
            schedule
          </Link>
          . Here is its record{live ? ` in ${live.season}` : ""}.
        </p>
      </div>

      {scorecardQuery.isLoading ? (
        <LoadingState label="Loading the model's record…" />
      ) : scorecardQuery.isError ? (
        <ErrorState message={queryErrorMessage(scorecardQuery.error)} />
      ) : !live ? (
        <EmptyState
          title="No graded predictions yet"
          message="Predictions are graded once their games are final. Nothing has been graded yet."
        />
      ) : (
        <ModelRecord row={live} />
      )}
    </div>
  );
}

function ModelRecord({ row }: { row: ScorecardRow }) {
  const market = marketComparison(row);
  const edge =
    row.accuracy != null && row.home_always_accuracy != null
      ? Math.round((row.accuracy - row.home_always_accuracy) * 100)
      : null;
  return (
    <>
      <KpiStrip className="sm:grid-cols-1 sm:max-lg:[&>*]:border-r-0! sm:max-lg:[&>*+*]:border-t lg:grid-cols-3">
        <KpiCard
          label="Picked the winner"
          value={formatProbability(row.accuracy)}
          progress={row.accuracy ?? undefined}
          note={
            row.accuracy != null ? `${Math.round(row.accuracy * row.n)} of ${row.n} games` : null
          }
        />
        <KpiCard
          label="Vs. the sportsbook"
          value={<KpiTitle>{market.title}</KpiTitle>}
          note={market.note}
        />
        <KpiCard
          label="Vs. always picking home"
          value={
            edge == null ? "—" : `${edge > 0 ? "+" : edge < 0 ? "−" : ""}${Math.abs(edge)} pts`
          }
          note={
            row.home_always_accuracy != null
              ? `the home team won ${formatProbability(row.home_always_accuracy)} of games`
              : null
          }
        />
      </KpiStrip>

      <div className="grid gap-x-14 gap-y-10 lg:grid-cols-2">
        <Calibration />
        <ModelWeights />
      </div>

      <Details row={row} />

      <RecentCalls />
    </>
  );
}

/**
 * What the live model weighs on its newest run. Silent until a run has stored
 * its settings: there is nothing true to say before then.
 */
function ModelWeights() {
  const query = useQuery({
    queryKey: ["prediction-weights"],
    queryFn: () => api.getLiveModelWeights(),
  });
  if (!query.data) return null;
  return (
    <section data-testid="model-weights">
      <h2 className="type-module border-b border-rule-strong pb-2">What goes into the number</h2>
      <ul>
        {weightLines(query.data).map((line) => (
          <li
            key={line.label}
            className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 border-b border-rule py-3"
          >
            <span>{line.label}</span>
            <span>
              <strong className="font-semibold">{line.value}</strong>
              <span className="block text-sm text-ink-3">{line.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="type-caption mt-3">
        Points are points on the scoreboard. Updated every morning from the games played so far.
      </p>
    </section>
  );
}

function Calibration() {
  const query = useQuery({
    queryKey: ["prediction-calibration"],
    queryFn: () => api.getPredictionCalibration(),
  });
  const buckets = query.data ?? [];
  return (
    <section>
      <h2 className="type-module border-b border-rule-strong pb-2">Does 70% mean 70%?</h2>
      {query.isLoading ? (
        <LoadingState label="Loading…" />
      ) : query.isError ? (
        <ErrorState message={queryErrorMessage(query.error)} />
      ) : (
        <>
          <ul>
            {buckets.map((bucket) => (
              <BucketRow key={bucket.bucket} bucket={bucket} />
            ))}
          </ul>
          <p className="type-caption mt-3">
            Bar: how often the home team actually won. Tick: the chance the model gave it. Close
            together is good.
          </p>
        </>
      )}
    </section>
  );
}

function BucketRow({ bucket }: { bucket: CalibrationBucket }) {
  return (
    <li
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-rule py-3"
      data-testid="calibration-bucket"
    >
      <span className="w-32 whitespace-nowrap">Home {bucket.bucket}</span>
      <div
        role="img"
        aria-label={`Model gave the home team ${Math.round(bucket.predicted * 100)}%, it won ${Math.round(bucket.actual * 100)}%`}
        className="relative h-2 bg-rule"
      >
        <div className="h-full bg-primary" style={{ width: `${bucket.actual * 100}%` }} />
        <div
          className="absolute -top-1 -bottom-1 w-0.5 bg-foreground"
          style={{ left: `${bucket.predicted * 100}%` }}
        />
      </div>
      <span className="tabular text-right whitespace-nowrap text-ink-2">
        won <strong className="text-foreground">{formatProbability(bucket.actual)}</strong>{" "}
        <span className="text-sm text-ink-3">
          ({bucket.n} {bucket.n === 1 ? "game" : "games"})
        </span>
      </span>
    </li>
  );
}

/** Every graded game, newest first, ten at a time, optionally for one team. */
function RecentCalls() {
  const [team, setTeam] = useState("");
  // Back to the first page whenever the team changes. Held with the team it
  // belongs to rather than reset in an effect, so a new team never fetches its
  // page 2 first.
  const [paging, setPaging] = useState({ team, page: 0 });
  const page = paging.team === team ? paging.page : 0;

  // Same query key as the other directories, so this shares their cached list.
  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
  });
  const teamOptions = useMemo(
    () =>
      (teamsQuery.data?.data ?? [])
        .flatMap((item) => (item.abbreviation ? [item.abbreviation] : []))
        .sort((left, right) => left.localeCompare(right)),
    [teamsQuery.data]
  );

  const query = useQuery({
    queryKey: ["prediction-games", team, page],
    queryFn: () =>
      api.listPredictionGames({
        team: team || undefined,
        limit: CALLS_PAGE,
        offset: page * CALLS_PAGE,
      }),
    // Keep the previous rows mounted while the next page loads, so the list
    // does not collapse and throw the reader back up the page.
    placeholderData: keepPreviousData,
  });
  const games = query.data?.data ?? [];
  const total = query.data?.meta.total ?? 0;
  const pages = Math.ceil(total / CALLS_PAGE);
  const shownPage = query.isPlaceholderData ? paging.page : page;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-strong pb-2">
        <h2 className="type-module">Recent calls</h2>
        <TeamSelect team={team} teams={teamOptions} setTeam={setTeam} />
      </div>
      {query.isPending ? (
        <LoadingState label="Loading…" />
      ) : query.isError ? (
        <ErrorState message={queryErrorMessage(query.error)} />
      ) : games.length === 0 ? (
        <EmptyState
          message={team ? `No graded games involving ${team} yet.` : "No graded games yet."}
        />
      ) : (
        <ul className={cn(query.isPlaceholderData && "opacity-60")} aria-busy={query.isFetching}>
          {games.map((game) => (
            <CallRow key={game.game_id} game={game} />
          ))}
        </ul>
      )}
      {pages > 1 ? (
        <PageNav
          label="Recent calls pages"
          status={`Page ${shownPage + 1} of ${pages}`}
          hasPrev={page > 0}
          hasNext={page + 1 < pages}
          loading={query.isPlaceholderData}
          onPrev={() => setPaging({ team, page: page - 1 })}
          onNext={() => setPaging({ team, page: page + 1 })}
        />
      ) : null}
    </section>
  );
}

function CallRow({ game }: { game: PredictionGame }) {
  const call = modelCall(game);
  return (
    <li
      className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto_1rem] items-center gap-4 border-b border-rule py-3"
      data-testid="recent-call"
    >
      <span className="text-sm text-ink-2">{formatShortDate(game.game_date)}</span>
      <Link href={`/games/${game.game_id}`} className="hover:text-primary hover:underline">
        {call.team} {Math.round(call.chance * 100)}% vs {call.opponent}
      </Link>
      <span className="text-sm text-ink-2">{call.winner} won</span>
      {call.correct ? (
        <Check aria-label="Called it" className="size-4 text-primary" />
      ) : (
        <X aria-label="Missed it" className="size-4 text-destructive" />
      )}
    </li>
  );
}

function Details({ row }: { row: ScorecardRow }) {
  return (
    <details className="group border-y border-rule">
      <summary className="flex cursor-pointer items-baseline gap-3 py-4 [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">Accuracy Details</span>
        <span className="text-ink-2 max-sm:hidden">log loss, Brier score, calibration error</span>
        <span aria-hidden className="ml-auto text-ink-3 group-open:rotate-180">
          ▼
        </span>
      </summary>
      <div className="overflow-x-auto pb-4">
        <table className="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <ColumnHelp label="Games" title="Games">
                <p>Final games graded. The sportsbook row counts only games with odds on file.</p>
              </ColumnHelp>
              <ColumnHelp label="Log loss" title="Log loss">
                <p>
                  How surprised the model was by the results. A confident pick that loses costs far
                  more than a close call. Lower is better.
                </p>
              </ColumnHelp>
              <ColumnHelp label="Brier" title="Brier score">
                <p>
                  The average squared gap between the predicted win chance and the result. Lower is
                  better; calling every game 50/50 scores 0.250.
                </p>
              </ColumnHelp>
              <ColumnHelp label="Accuracy" title="Accuracy">
                <p>
                  How often the team given the better chance won. For context, home teams win about
                  54% of games and sportsbook favorites about two in three.
                </p>
              </ColumnHelp>
              <ColumnHelp label="Calibration error" title="Calibration error" align="end">
                <p>
                  The average gap between predicted and actual win rates, with games grouped by
                  predicted chance (50–60%, 60–70%, and so on). When the model says 70%, that team
                  should win about 70% of the time. Lower is better.
                </p>
              </ColumnHelp>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{modelLabel(row)}</td>
              <td className="tabular">{formatNumber(row.n)}</td>
              <td className="tabular">{formatNumber(row.logloss, 3)}</td>
              <td className="tabular">{formatNumber(row.brier, 3)}</td>
              <td className="tabular">{formatProbability(row.accuracy)}</td>
              <td className="tabular">{formatNumber(row.calibration_error, 3)}</td>
            </tr>
            <BaselineRows baseline={row} />
          </tbody>
        </table>
      </div>
    </details>
  );
}
