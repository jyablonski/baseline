"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { ColumnHelp } from "@/components/column-help";
import { BaselineRows } from "@/components/predictions/baseline-rows";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { api, queryErrorMessage } from "@/lib/api";
import { formatNumber, formatProbability } from "@/lib/format";
import { modelLabel } from "@/lib/predictions";
import type { ScorecardRow } from "@/lib/types";

export default function PredictionsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading model scorecard…" />}>
      <Predictions />
    </Suspense>
  );
}

function Predictions() {
  const scorecardQuery = useQuery({
    queryKey: ["prediction-scorecard"],
    queryFn: () => api.getPredictionScorecard(),
  });

  const rows = scorecardQuery.data?.rows ?? [];
  const seasons = [...new Set(rows.map((row) => row.season))];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-page">Model Scorecard</h1>
        <p className="mt-1 text-sm text-ink-2">
          How our pregame win odds held up against the results. &ldquo;On Schedule Tab&rdquo; marks
          the model shown on the{" "}
          <Link href="/schedule" className="underline underline-offset-2">
            schedule
          </Link>
          .
        </p>
      </div>

      {scorecardQuery.isLoading ? (
        <LoadingState label="Loading model scorecard…" />
      ) : scorecardQuery.isError ? (
        <ErrorState message={queryErrorMessage(scorecardQuery.error)} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No graded predictions yet"
          message="Predictions are graded once their games are final. Nothing has been graded yet."
        />
      ) : (
        seasons.map((season) => (
          <SeasonScorecard
            key={season}
            season={season}
            rows={rows.filter((row) => row.season === season)}
          />
        ))
      )}
    </div>
  );
}

function SeasonScorecard({ season, rows }: { season: string; rows: ScorecardRow[] }) {
  // Market and always-home baselines are per season, repeated on every model row.
  const baseline = rows[0];
  return (
    <section className="space-y-2">
      <h2 className="type-module">{season}</h2>
      <div className="overflow-x-auto">
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
            {rows.map((row) => (
              <tr key={row.model_version}>
                <td>
                  {modelLabel(row)}
                  {row.is_champion ? (
                    <span className="ml-2 text-xs text-muted-foreground">On Schedule Tab</span>
                  ) : null}
                </td>
                <td className="tabular">{formatNumber(row.n)}</td>
                <td className="tabular">{formatNumber(row.logloss, 3)}</td>
                <td className="tabular">{formatNumber(row.brier, 3)}</td>
                <td className="tabular">{formatProbability(row.accuracy)}</td>
                <td className="tabular">{formatNumber(row.calibration_error, 3)}</td>
              </tr>
            ))}
            <BaselineRows baseline={baseline} />
          </tbody>
        </table>
      </div>
    </section>
  );
}
