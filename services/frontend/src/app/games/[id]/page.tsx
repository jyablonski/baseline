"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { GameFlowChart } from "@/components/charts/game-flow-chart";
import { BoxScore } from "@/components/games/box-score";
import { pickSummary, WhoWins } from "@/components/games/game-pick";
import {
  BeforeTipoff,
  GameHeader,
  isFinal,
  SeriesPanel,
  ThisSeasonPanel,
} from "@/components/games/game-summary";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { usePicks } from "@/hooks/use-picks";
import { useProfile } from "@/hooks/use-profile";
import { useSeasonMeetings } from "@/hooks/use-season-meetings";
import { api, queryErrorMessage } from "@/lib/api";
import { formatNumber, formatProbability } from "@/lib/format";
import { selectBiggestRun } from "@/lib/game-flow";
import {
  homeWon,
  losingCard,
  recapHeadline,
  starCard,
  turningPointCard,
  type Meeting,
  type RecapCard,
} from "@/lib/game-story";
import { hasTipped } from "@/lib/timezones";
import type { GameDetail, GameFlow } from "@/lib/types";

export default function GamePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading game…" />}>
      <GameBody />
    </Suspense>
  );
}

/** One game in any state: a preview before tip-off, the recap once it is Final. */
function GameBody() {
  const params = useParams<{ id: string }>();
  const gameId = String(params.id ?? "");
  const { timezone } = useProfile();

  const gameQuery = useQuery({
    queryKey: ["game", gameId],
    queryFn: () => api.getGame(gameId),
    enabled: Boolean(gameId),
  });
  const game = gameQuery.data;
  // Until the meetings load, a playoff game cannot say which game of the
  // series it is or how the series stands, so those wait rather than flicker.
  const { meetings, isLoading: meetingsLoading } = useSeasonMeetings(game);

  if (gameQuery.isLoading) return <LoadingState label="Loading game…" />;
  if (gameQuery.isError) return <ErrorState message={queryErrorMessage(gameQuery.error)} />;
  if (!game) return <EmptyState message="Game not found." />;

  const final = isFinal(game);
  const tipped = final || hasTipped(game.game_date, game.start_time_et);

  return (
    <div className="space-y-10">
      <GameHeader
        game={game}
        meetings={meetings}
        meetingsLoading={meetingsLoading}
        timezone={timezone}
        tipped={tipped}
      />
      {final ? (
        <>
          <GameRecap game={game} meetings={meetings} meetingsLoading={meetingsLoading} />
          <div className="grid gap-10 lg:grid-cols-2">
            <SeriesPanel game={game} meetings={meetings} timezone={timezone} />
            <ThisSeasonPanel game={game} meetings={meetings} />
          </div>
        </>
      ) : (
        <>
          <WhoWins game={game} tipped={tipped} />
          <div className="grid gap-10 lg:grid-cols-2">
            <BeforeTipoff game={game} />
            <SeriesPanel game={game} meetings={meetings} timezone={timezone} />
          </div>
        </>
      )}

      <p className="flex flex-wrap gap-x-6 text-sm">
        <Link href="/games" className="text-primary hover:underline">
          All recent final games →
        </Link>
        <Link href="/schedule" className="text-primary hover:underline">
          Full schedule →
        </Link>
      </p>
    </div>
  );
}

/** A Final game: what happened in words, then the flow and the box score. */
function GameRecap({
  game,
  meetings,
  meetingsLoading,
}: {
  game: GameDetail;
  meetings: Meeting[];
  meetingsLoading: boolean;
}) {
  const gameId = game.game_id;
  const flowQuery = useQuery({
    queryKey: ["game-flow", gameId],
    queryFn: () => api.getGameFlow(gameId),
  });
  const pbpQuery = useQuery({
    queryKey: ["game-pbp", gameId],
    queryFn: () => api.getGamePlayByPlay(gameId),
  });
  // Its own query: a game can have player lines without a scoring timeline, so
  // the box score should not disappear with the chart.
  const boxScoreQuery = useQuery({
    queryKey: ["game-box-score", gameId],
    queryFn: () => api.getGameBoxScore(gameId),
  });

  const flow = flowQuery.data;
  const events = pbpQuery.data?.data ?? [];
  const boxScore = boxScoreQuery.data?.data ?? [];
  const hasFlow = Boolean(flow?.has_play_by_play) && events.length > 0;
  // The same run the chart shades, so the words and the picture agree.
  const run =
    flow && hasFlow
      ? selectBiggestRun(events, {
          homeAbbreviation: flow.home_team_abbreviation,
          awayAbbreviation: flow.away_team_abbreviation,
        })
      : null;
  const homeSideWon = homeWon(game);
  const homeName = game.home_team_nickname ?? game.home_team_abbreviation ?? "Home";
  const awayName = game.away_team_nickname ?? game.away_team_abbreviation ?? "Away";

  return (
    <>
      <RecapSummary
        game={game}
        meetings={meetings}
        meetingsLoading={meetingsLoading}
        cards={[
          starCard(boxScore, game),
          flow && hasFlow ? turningPointCard(flow, run) : null,
          losingCard(boxScore, game, homeSideWon ? awayName : homeName),
        ].filter((card): card is RecapCard => card != null)}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
          <h2 className="type-module">Game flow</h2>
          {flow && hasFlow ? <FlowFacts flow={flow} /> : null}
        </div>
        {flowQuery.isLoading || pbpQuery.isLoading ? (
          <LoadingState label="Loading PBP…" />
        ) : flowQuery.isError ? (
          <ErrorState message={queryErrorMessage(flowQuery.error)} />
        ) : pbpQuery.isError ? (
          <ErrorState message={queryErrorMessage(pbpQuery.error)} />
        ) : !flow || !hasFlow ? (
          <EmptyState
            title="No PBP data available."
            message="There's no scoring timeline for this game."
          />
        ) : (
          <GameFlowChart events={events} flow={flow} />
        )}
      </section>

      {boxScoreQuery.isLoading ? (
        <LoadingState label="Loading box score…" />
      ) : boxScoreQuery.isError ? (
        <ErrorState message={queryErrorMessage(boxScoreQuery.error)} />
      ) : boxScore.length === 0 ? (
        <EmptyState
          title="No box score for this game."
          message="No player game logs have been loaded for it."
        />
      ) : (
        <BoxScore
          rows={boxScore}
          // Away first, as the scoreboard reads; the winner opens.
          sides={[
            { teamId: game.away_team_id, label: `${awayName} ${game.away_score}` },
            { teamId: game.home_team_id, label: `${homeName} ${game.home_score}` },
          ]}
          defaultTeamId={homeSideWon ? game.home_team_id : game.away_team_id}
        />
      )}
    </>
  );
}

function RecapSummary({
  game,
  meetings,
  meetingsLoading,
  cards,
}: {
  game: GameDetail;
  meetings: Meeting[];
  meetingsLoading: boolean;
  cards: RecapCard[];
}) {
  const picks = usePicks();
  const pick = picks.sheet?.picks.find((item) => item.game_id === game.game_id);
  const calls = [
    ["Model", callLine(game, game.home_win_probability)],
    ["Market", callLine(game, game.market_home_wp)],
    ["Your pick", pick ? pickSummary(pick) : null],
  ].filter((call): call is [string, string] => call[1] != null);

  return (
    <section className="space-y-4">
      <h2 className="type-page text-center text-2xl sm:text-3xl" data-testid="recap-headline">
        {/* A non-breaking space holds the line's height while it waits. */}
        {meetingsLoading ? "\u00a0" : recapHeadline(game, meetings)}
      </h2>
      {cards.length > 0 ? (
        <div
          className="grid border-y border-rule sm:grid-cols-3 sm:divide-x sm:divide-rule"
          data-testid="recap-cards"
        >
          {cards.map((card) => (
            <div key={card.label} className="py-4 sm:px-6 sm:first:pl-0" data-testid="recap-card">
              <p className="text-sm text-ink-2">{card.label}</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-4xl tabular">{card.figure}</span>
                <span className="font-semibold">{card.name}</span>
              </p>
              {card.caption ? <p className="mt-1 text-sm text-ink-2">{card.caption}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      {calls.length > 0 ? (
        <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
          {calls.map(([label, value]) => (
            <span key={label} data-testid="recap-call">
              <span className="font-semibold text-foreground">{label}</span> {value}
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}

/** "Had SAS at 60% before tip-off · Missed", or null without a line. */
function callLine(game: GameDetail, homeWp: number | null | undefined) {
  if (homeWp == null || game.home_score == null || game.away_score == null) return null;
  const homeFavoured = homeWp >= 0.5;
  const favourite = homeFavoured ? game.home_team_abbreviation : game.away_team_abbreviation;
  const right = homeFavoured === homeWon(game);
  return `Had ${favourite} at ${formatProbability(homeFavoured ? homeWp : 1 - homeWp)} before tip-off · ${right ? "Called it" : "Missed"}`;
}

/** The flow in four numbers beside the heading: who led, by most, and how often it swung. */
function FlowFacts({ flow }: { flow: GameFlow }) {
  const home = flow.home_team_abbreviation ?? "Home";
  const away = flow.away_team_abbreviation ?? "Away";
  const homeShare = flow.home_lead_pct ?? 0;
  const awayShare = flow.away_lead_pct ?? 0;
  const leader = homeShare >= awayShare ? home : away;
  const share = Math.round(Math.max(homeShare, awayShare) * 100);
  // Without the per-side leads, say the size and not a team it might not be.
  const maxLeadTeam =
    flow.max_home_lead == null && flow.max_away_lead == null
      ? null
      : (flow.max_home_lead ?? 0) >= (flow.max_away_lead ?? 0)
        ? home
        : away;
  const fact = (label: string, value: string) => (
    <span>
      {label} <span className="font-semibold text-foreground">{value}</span>
    </span>
  );
  return (
    <p className="flex flex-wrap gap-x-5 text-sm text-ink-2" data-testid="flow-facts">
      {fact(`${leader} led`, `${share}%`)}
      {flow.max_lead != null
        ? fact("Max lead", `${maxLeadTeam ? `${maxLeadTeam} ` : ""}+${flow.max_lead}`)
        : null}
      {fact("Lead changes", formatNumber(flow.lead_changes))}
      {fact("Ties", formatNumber(flow.ties))}
    </p>
  );
}
