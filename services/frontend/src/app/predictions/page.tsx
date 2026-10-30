"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";

import { ColumnHelp } from "@/components/column-help";
import { BaselineRows } from "@/components/predictions/baseline-rows";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { KpiCard, KpiStrip, KpiTitle } from "@/components/ui/kpi-card";
import { api, queryErrorMessage } from "@/lib/api";
import { formatNumber, formatProbability, formatShortDate } from "@/lib/format";
import { latestSeason, marketComparison, modelCall, modelLabel } from "@/lib/predictions";
import type { CalibrationBucket, PredictionGame, ScorecardRow } from "@/lib/types";

const CALLS_PAGE = 20;

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
        <RecentCalls total={row.n} />
      </div>

      <Details row={row} />
    </>
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
            Bar: how often those teams actually won. Tick: what the model said. Close together is
            good.
          </p>
        </>
      )}
    </section>
  );
}

function BucketRow({ bucket }: { bucket: CalibrationBucket }) {
  return (
    <li
      className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-rule py-3"
      data-testid="calibration-bucket"
    >
      <span>Said {bucket.bucket}</span>
      <div
        role="img"
        aria-label={`Model said ${Math.round(bucket.predicted * 100)}%, actually ${Math.round(bucket.actual * 100)}%`}
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

function RecentCalls({ total }: { total: number }) {
  const query = useInfiniteQuery({
    queryKey: ["prediction-games"],
    queryFn: ({ pageParam }) => api.listPredictionGames({ limit: CALLS_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.data.length, 0);
      return lastPage.data.length === CALLS_PAGE && loaded < total ? loaded : undefined;
    },
  });
  const games = query.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <section>
      <h2 className="type-module border-b border-rule-strong pb-2">Recent calls</h2>
      {query.isLoading ? (
        <LoadingState label="Loading…" />
      ) : query.isError ? (
        <ErrorState message={queryErrorMessage(query.error)} />
      ) : (
        <ul>
          {games.map((game) => (
            <CallRow key={game.game_id} game={game} />
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <button
          type="button"
          className="mt-3 text-sm text-primary"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          Show {Math.min(CALLS_PAGE, total - games.length)} more of {total} games
        </button>
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
