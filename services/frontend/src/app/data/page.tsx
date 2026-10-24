"use client";

import { useQuery } from "@tanstack/react-query";

import { DeveloperCard } from "@/components/layout/developer-card";
import { RefreshTime } from "@/components/layout/refresh-time";
import { BaselineRows } from "@/components/predictions/baseline-rows";
import { ErrorState, LoadingState } from "@/components/query-state";
import { KpiCard, KpiStrip } from "@/components/ui/kpi-card";
import { useProfile } from "@/hooks/use-profile";
import { api, queryErrorMessage } from "@/lib/api";
import { CONTACT_EMAIL } from "@/lib/contact";
import { formatNumber, formatProbability } from "@/lib/format";
import { modelLabel } from "@/lib/predictions";
import { formatInstant } from "@/lib/timezones";
import type { ScorecardRow } from "@/lib/types";
import { commitUrl, shortSha } from "@/lib/version";

// Below this many graded games the scorecard gaps between models are mostly noise.
const SMALL_SAMPLE_GAMES = 100;

const SOURCES = [
  {
    name: "Basketball-Reference",
    href: "https://www.basketball-reference.com",
    detail:
      "Teams, players, the season slate, box scores, standings, play-by-play, remaining-year player salaries, team payroll, transactions, and the injury report.",
  },
  {
    name: "The Odds API",
    href: "https://the-odds-api.com",
    detail: "Moneylines and spreads for upcoming games, from several bookmakers.",
  },
  {
    name: "ESPN",
    href: "https://www.espn.com/nba/scoreboard",
    detail: "National TV listings for the next two weeks.",
  },
  {
    name: "Reddit",
    href: "https://www.reddit.com/r/nba",
    detail: "r/nba posts and their top comments.",
  },
];

const STEPS = [
  { title: "Scrape", detail: "Yesterday's results, the upcoming slate, odds, injuries and r/nba." },
  { title: "Clean", detail: "Match every source to one set of teams, players and games." },
  { title: "Enrich", detail: "Runs, leads, upsets, highlights, MVP scores and social metrics." },
  { title: "Predict", detail: "Win models score the coming week's games before tip-off." },
  { title: "Serve", detail: "The finished tables feed every page in this app." },
];

const DERIVED = [
  {
    title: "True shooting %",
    pages: "Game",
    detail:
      "Points per shooting possession, so threes and free throws count for what they are worth: PTS ÷ (2 × (FGA + 0.44 × FTA)).",
  },
  {
    title: "Implied win %",
    pages: "Game",
    detail:
      "Each bookmaker's moneyline turned into a chance of winning with its margin removed, so both sides add to 100%, then averaged across bookmakers.",
  },
  {
    title: "Upsets",
    pages: "Games, Game, Picks",
    detail:
      "A win by the team the market made the underdog, ranked by how unlikely it was. Pick'em games have no favourite and never count.",
  },
  {
    title: "Runs, leads and comebacks",
    pages: "Game, Games",
    detail:
      "From scoring play-by-play: time spent ahead, the largest lead, lead changes, the biggest scoring run, and the largest lead the loser let slip.",
  },
  {
    title: "Daily highlights",
    pages: "Home, Games",
    detail:
      "Each game's candidate stories (season highs, streaks, blown leads, scoring duels, upsets) scored and ranked. The best one is the line under each score.",
  },
  // injury_notable_team_rank / injury_notable_league_rank in services/dbt/dbt_project.yml.
  {
    title: "Notable absences",
    pages: "Schedule, Game, Players, Teams",
    detail:
      "Injured players flagged when they rank in their team's top two or the league's top 30 by average game score.",
  },
  {
    title: "Social metrics",
    pages: "Social",
    detail:
      "Discussion ratio, contested posts, player and team mentions, and comment counts by fanbase flair.",
  },
  {
    title: "Cap position",
    pages: "Teams",
    detail:
      "Payroll placed against the salary cap, tax line and both aprons for the current season.",
  },
];

const SCORES = [
  // Mirrors mvp_box_score in services/dbt/models/intermediate/int_player_game_logs_enriched.sql.
  {
    title: "Game score",
    pages: "Game, Players",
    detail:
      "A one-number summary of a single game, after John Hollinger's Game Score. The logs carry total rebounds and no fouls, so rebounds take one blended weight and the foul term is dropped.",
    formula:
      "PTS + 0.4·FGM − 0.7·FGA − 0.4·(FTA − FTM)\n    + 0.4·REB + STL + 0.7·AST + 0.7·BLK − TOV",
  },
  // mvp_win_weight and the mvp_availability_* vars in services/dbt/dbt_project.yml.
  {
    title: "MVP score",
    pages: "Game, Players",
    detail:
      "A player's season so far: game score credited for winning, averaged, then discounted for games missed. The MVP column in a box score is that game's win-adjusted score.",
    formula:
      "game MVP  = game score ± 20% of |game score|   (+ in a win, − in a loss)\nMVP score = average game MVP × availability\n\navailability: full until 10% of team games missed, then\n              falls along a curve to 0.75 at 50% missed",
  },
  // DISCUSSION_RATIO and CONTESTED_* in services/api/src/queries/social.py.
  {
    title: "Discussion ratio",
    pages: "Social",
    detail:
      "How much a post is argued about relative to how much it is upvoted. Many comments on a low score reads as contested.",
    formula:
      "discussion ratio = comments ÷ max(score, 1)\ncontested when score ≤ 25 and comments ≥ 50",
  },
];

const MODEL_NOTES: Record<string, string> = {
  "elo-v0": "Rating that moves after every result",
  "elo-v1": "Adds margin of victory and a learned home edge",
  "logit-v1": "Eleven pregame stats: form, rest, travel and more",
};

const LIMITS = [
  "Stats can lag up to a day; everything updates once each morning.",
  "Injury reports are a snapshot from the morning run and can change before tip-off.",
  "Odds are a bookmaker consensus from the morning run, not live or closing lines.",
  "The win models do not know who is playing tonight, so injuries and rest are their biggest blind spot.",
  "Social metrics only see r/nba and the top comments of each post; fanbase counts include flaired comments only.",
  "Only the current season is loaded.",
  "Model numbers early in the season rest on very few games.",
];

export default function DataPage() {
  const sha = shortSha();
  const href = commitUrl();
  const { timezone } = useProfile();
  const statusQuery = useQuery({ queryKey: ["status"], queryFn: () => api.getStatus() });
  const scorecardQuery = useQuery({
    queryKey: ["prediction-scorecard"],
    queryFn: () => api.getPredictionScorecard(),
  });

  const status = statusQuery.data;
  const scorecard = latestSeason(scorecardQuery.data?.rows ?? []);
  // Null until the scorecard has rows, so the KPI reads "—" rather than flashing 0 while it loads.
  const gamesScored = scorecard.find((row) => row.is_champion)?.n ?? scorecard[0]?.n ?? null;
  const lastRefresh = refreshParts(status?.last_scraped_at, timezone);
  const nextRefresh = refreshParts(status?.next_scrape_at, timezone);

  return (
    <article className="space-y-10">
      <header>
        <h1 className="type-page">About the data</h1>
        <p className="type-prose mt-1">
          An NBA analytics app covering box scores, player and team stats, contract snapshots,
          betting odds, and Elo-based win predictions, updated daily throughout the season.
        </p>
        <p className="mt-2 text-sm text-ink-2">
          This page lists where every number comes from, what Baseline adds on top, and how its own
          scores and models are calculated.
        </p>
      </header>

      <KpiStrip>
        <KpiCard label="Last refresh" value={lastRefresh?.time ?? "—"} note={lastRefresh?.note} />
        <KpiCard label="Next refresh" value={nextRefresh?.time ?? "—"} note={nextRefresh?.note} />
        <KpiCard
          label="Coverage"
          value={status?.last_season ?? "—"}
          note="Regular season, play-in and playoffs"
        />
        <KpiCard
          label="Games scored"
          value={gamesScored == null ? "—" : formatNumber(gamesScored)}
          note="by the win models"
        />
      </KpiStrip>

      <DataSection title="Sources">
        <ul>
          {SOURCES.map((source) => (
            <li
              key={source.name}
              className="grid gap-1 border-b border-rule py-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:gap-6"
            >
              <a
                className="font-medium text-foreground underline underline-offset-2"
                href={source.href}
                target="_blank"
                rel="noreferrer"
              >
                {source.name}
              </a>
              <p>{source.detail}</p>
              <p className="text-sm text-ink-2 sm:text-right">
                Daily, <RefreshTime />
              </p>
            </li>
          ))}
        </ul>
      </DataSection>

      <DataSection title="How the data gets here">
        <p>
          The sources are scraped every day around <RefreshTime />, picking up the previous
          day&apos;s games and the upcoming slate. The data is then transformed and enriched into
          analytics tables and served out over this app.
        </p>
        <ol className="mt-4 grid gap-4 border-y border-rule py-4 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <p className="type-timestamp text-primary">{String(index + 1).padStart(2, "0")}</p>
              <p className="mt-1 font-medium text-foreground">{step.title}</p>
              <p className="mt-1 text-sm text-ink-2">{step.detail}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-ink-2">
          Coverage is the latest season only. Preseason games are not included.
        </p>
      </DataSection>

      <DataSection title="What Baseline adds">
        <p className="text-sm text-ink-2">
          Derived from the sources above. Nothing here is supplied by them directly.
        </p>
        <dl className="mt-2">
          {DERIVED.map((item) => (
            <div
              key={item.title}
              className="grid gap-1 border-b border-rule py-3 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-6"
            >
              <dt>
                <span className="font-medium text-foreground">{item.title}</span>
                <span className="type-caption block">{item.pages}</span>
              </dt>
              <dd>{item.detail}</dd>
            </div>
          ))}
        </dl>
      </DataSection>

      <DataSection title="Baseline's own scores">
        <div>
          {SCORES.map((score) => (
            <section key={score.title} className="border-b border-rule py-4 first:pt-0">
              <h3 className="flex items-baseline gap-3">
                <span className="type-module">{score.title}</span>
                <span className="type-caption">{score.pages}</span>
              </h3>
              <p className="mt-1">{score.detail}</p>
              <pre className="type-sql mt-3 overflow-x-auto border border-rule bg-surface p-4">
                {score.formula}
              </pre>
            </section>
          ))}
        </div>
      </DataSection>

      <DataSection
        title="Win prediction models"
        aside={
          scorecard.length > 0
            ? `${scorecard[0].season} · ${formatNumber(gamesScored)} games scored`
            : undefined
        }
      >
        <p>
          Each model gives a pregame chance for every game. After the game, its forecast is scored
          against the result. Lower log loss, Brier and calibration error are better.
        </p>
        <div className="mt-4">
          {scorecardQuery.isLoading ? (
            <LoadingState label="Loading model scorecard…" />
          ) : scorecardQuery.isError ? (
            <ErrorState message={queryErrorMessage(scorecardQuery.error)} />
          ) : scorecard.length === 0 ? (
            <p className="text-sm text-ink-2">
              Predictions are graded once their games are final. Nothing has been graded yet.
            </p>
          ) : (
            <ModelTable rows={scorecard} />
          )}
        </div>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <MetricNote term="Log loss">
            Penalises confident wrong calls heavily. 0.693 is a coin flip.
          </MetricNote>
          <MetricNote term="Brier">
            Average squared gap between the forecast and the result. 0.250 is a coin flip.
          </MetricNote>
          <MetricNote term="Accuracy">
            Share of games the team given the better chance won.
          </MetricNote>
          <MetricNote term="Calibration error">
            How far &ldquo;60%&rdquo; calls land from winning 60% of the time.
          </MetricNote>
        </dl>
        {gamesScored != null && gamesScored > 0 && gamesScored < SMALL_SAMPLE_GAMES ? (
          <p className="mt-3 text-sm text-ink-2">
            {formatNumber(gamesScored)} games is too few to separate these models; differences this
            early are mostly noise.
          </p>
        ) : null}
      </DataSection>

      <DataSection title="Known limits">
        <ul>
          {LIMITS.map((limit) => (
            <li key={limit} className="border-b border-rule py-3">
              {limit}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-ink-2">
          Spot a wrong number?{" "}
          <a
            className="underline underline-offset-2"
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Baseline data issue")}`}
          >
            Report it
          </a>{" "}
          with the game or player and what looks off.
        </p>
      </DataSection>

      <DataSection title="Developer">
        <div className="flex items-center justify-between gap-4">
          <DeveloperCard />
          <div className="text-right">
            <p className="type-caption">Version</p>
            {href ? (
              <a
                className="type-timestamp underline underline-offset-2"
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                {sha}
              </a>
            ) : (
              <p className="type-timestamp">{sha}</p>
            )}
          </div>
        </div>
      </DataSection>
    </article>
  );
}

function DataSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 border-b border-rule-strong pb-1">
        <h2 className="type-module">{title}</h2>
        {aside ? <p className="text-sm text-ink-2">{aside}</p> : null}
      </div>
      <div className="type-prose mt-3">{children}</div>
    </section>
  );
}

function ModelTable({ rows }: { rows: ScorecardRow[] }) {
  // Market and always-home baselines are per season, repeated on every model row.
  const baseline = rows[0];
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Games</th>
            <th>Log loss</th>
            <th>Brier</th>
            <th>Accuracy</th>
            <th>Calibration</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.model_version}>
              <td>
                <span className="font-medium text-foreground">{modelLabel(row)}</span>
                {row.is_champion ? (
                  <span className="ml-2 text-xs text-primary uppercase">On schedule</span>
                ) : null}
                {MODEL_NOTES[row.model_version] ? (
                  <span className="type-caption block">{MODEL_NOTES[row.model_version]}</span>
                ) : null}
              </td>
              <td className="tabular">{formatNumber(row.n)}</td>
              <td className="tabular">{formatNumber(row.logloss, 3)}</td>
              <td className="tabular">{formatNumber(row.brier, 3)}</td>
              <td className="tabular">{formatProbability(row.accuracy)}</td>
              <td className="tabular">{formatNumber(row.calibration_error, 3)}</td>
            </tr>
          ))}
          <BaselineRows baseline={baseline} withNotes />
        </tbody>
      </table>
    </div>
  );
}

function MetricNote({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-foreground">{term}</dt>
      <dd className="mt-1 text-ink-2">{children}</dd>
    </div>
  );
}

/** Only the current season is loaded, but the scorecard is keyed by season: show the newest. */
function latestSeason(rows: ScorecardRow[]) {
  const season = rows.reduce<string | null>(
    (latest, row) => (latest == null || row.season > latest ? row.season : latest),
    null
  );
  return rows.filter((row) => row.season === season);
}

function refreshParts(value: string | null | undefined, timezone: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const { date, time, zone } = formatInstant(parsed, timezone);
  return { time, note: `${date} · ${zone}` };
}
