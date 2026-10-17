"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { SeasonSelect } from "@/components/season-select";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import { formatDate, formatNumber, formatProbability } from "@/lib/format";
import type { GameUpset, ScorecardRow } from "@/lib/types";

const UPSET_LIMIT = 25;

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

      <BiggestUpsets />
    </div>
  );
}

function BiggestUpsets() {
  const { season, seasons, setSeason, isLoading: seasonsLoading } = useSeason();
  const upsetsQuery = useQuery({
    queryKey: ["upsets", season],
    queryFn: () => api.listUpsets({ season: season || undefined, limit: UPSET_LIMIT }),
    enabled: !seasonsLoading,
  });
  const upsets = upsetsQuery.data?.data ?? [];

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="type-module">Biggest upsets</h2>
          <p className="mt-1 text-sm text-ink-2">
            Games the sportsbook underdog won, by how unlikely the morning line made it.
          </p>
        </div>
        <SeasonSelect season={season} seasons={seasons} setSeason={setSeason} />
      </div>
      {seasonsLoading || upsetsQuery.isLoading ? (
        <LoadingState label="Loading upsets…" />
      ) : upsetsQuery.isError ? (
        <ErrorState message={queryErrorMessage(upsetsQuery.error)} />
      ) : upsets.length === 0 ? (
        <EmptyState
          title="No upsets yet this season"
          message="An upset needs a final result and a pregame line to judge it by."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Date</th>
                <th>Game</th>
                <th>Winner</th>
                <th title="The winner's win probability on the morning line">Market</th>
                <th title="Baseline's pregame win probability for the winner">Model</th>
              </tr>
            </thead>
            <tbody>
              {upsets.map((upset, index) => (
                <UpsetRow key={upset.game_id} upset={upset} rank={index + 1} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function UpsetRow({ upset, rank }: { upset: GameUpset; rank: number }) {
  const homeWon = upset.winner_location === "home";
  const winner = homeWon ? upset.home_team_abbreviation : upset.away_team_abbreviation;
  const score =
    upset.home_score != null && upset.away_score != null
      ? ` ${upset.away_score}–${upset.home_score}`
      : "";
  return (
    <tr>
      <td className="tabular">{rank}</td>
      <td className="tabular">{formatDate(upset.game_date)}</td>
      <td>
        <Link href={`/games/${upset.game_id}`} className="text-primary hover:underline">
          {upset.away_team_abbreviation} @ {upset.home_team_abbreviation}
          {score}
        </Link>
      </td>
      <td className="font-semibold">{winner}</td>
      <td className="tabular">{formatProbability(upset.winner_market_wp)}</td>
      <td className="tabular">
        {formatProbability(upset.model_winner_wp)}
        {upset.model_called_upset ? (
          <span className="ml-2 text-xs text-primary">Called it</span>
        ) : null}
      </td>
    </tr>
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
