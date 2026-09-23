"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { api, queryErrorMessage } from "@/lib/api";
import { formatNumber, formatProbability } from "@/lib/format";
import type { ScorecardRow } from "@/lib/types";

const MODEL_LABELS: Record<string, string> = {
  elo: "Elo",
  logit: "Logistic regression",
};

// Two versions of one model can grade side by side (elo-v0 / elo-v1), so the
// name alone is ambiguous. "elo-v1" -> "Elo v1".
function modelLabel(row: ScorecardRow): string {
  const name = MODEL_LABELS[row.model_name] ?? row.model_name;
  const version = row.model_version.split("-").at(-1);
  return version && version !== row.model_version ? `${name} ${version}` : name;
}

export default function PredictionsPage() {
  const scorecardQuery = useQuery({
    queryKey: ["prediction-scorecard"],
    queryFn: () => api.getPredictionScorecard(),
  });

  const rows = scorecardQuery.data?.rows ?? [];
  const seasons = [...new Set(rows.map((row) => row.season))];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-page">Model scorecard</h1>
        <p className="mt-1 text-sm text-ink-2">
          How Baseline&apos;s pregame win probabilities have held up against final results. The
          model marked &ldquo;On schedule&rdquo; is the one shown on the{" "}
          <Link href="/schedule" className="underline underline-offset-2">
            schedule
          </Link>
          . Lower log loss and Brier score are better. The market row scores the sportsbook
          consensus on the games where odds were available.
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
              <th>Games</th>
              <th>Log loss</th>
              <th>Brier</th>
              <th>Accuracy</th>
              <th title="Average gap between predicted and actual win rate">Calibration error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.model_version}>
                <td>
                  {modelLabel(row)}
                  {row.is_champion ? (
                    <span className="ml-2 text-xs text-muted-foreground">On schedule</span>
                  ) : null}
                </td>
                <td className="tabular">{formatNumber(row.n)}</td>
                <td className="tabular">{formatNumber(row.logloss, 3)}</td>
                <td className="tabular">{formatNumber(row.brier, 3)}</td>
                <td className="tabular">{formatProbability(row.accuracy)}</td>
                <td className="tabular">{formatNumber(row.calibration_error, 3)}</td>
              </tr>
            ))}
            <tr>
              <td className="text-muted-foreground">Sportsbook market</td>
              <td className="tabular">{formatNumber(baseline.market_n)}</td>
              <td className="tabular">{formatNumber(baseline.market_logloss, 3)}</td>
              <td className="tabular">{formatNumber(baseline.market_brier, 3)}</td>
              <td className="tabular">—</td>
              <td className="tabular">—</td>
            </tr>
            <tr>
              <td className="text-muted-foreground">Always pick the home team</td>
              <td className="tabular">{formatNumber(baseline.n)}</td>
              <td className="tabular">—</td>
              <td className="tabular">—</td>
              <td className="tabular">{formatProbability(baseline.home_always_accuracy)}</td>
              <td className="tabular">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
