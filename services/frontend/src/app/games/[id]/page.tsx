"use client";

import { Fragment, Suspense, useId, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { GameFlowChart } from "@/components/charts/game-flow-chart";
import { BoxScore } from "@/components/games/box-score";
import { impliedProbability, WhoWins } from "@/components/games/game-pick";
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
  stageOf,
  starCard,
  turningPointCard,
  type Meeting,
  type RecapCard,
} from "@/lib/game-story";
import { formatMoney, formatPrice, formatSignedMoney, pickProfit } from "@/lib/picks";
import { isUpsetWin } from "@/lib/results";
import { hasTipped } from "@/lib/timezones";
import type { GameDetail, GameFlow, UserPick } from "@/lib/types";
import { cn } from "@/lib/utils";

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
          All results →
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

  return (
    <section className="space-y-4">
      {/* Regular-season games have no headline; the stage alone decides, so no wait for meetings. */}
      {stageOf(game.season_type, game) === "Regular Season" ? null : (
        <h2 className="type-page text-center text-2xl sm:text-3xl" data-testid="recap-headline">
          {/* A non-breaking space holds the line's height while it waits. */}
          {meetingsLoading ? "\u00a0" : recapHeadline(game, meetings)}
        </h2>
      )}
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
      <PregameCalls game={game} pick={pick} />
    </section>
  );
}

type PregameCall = {
  key: string;
  label: string;
  sub: string;
  /** The side it favoured, and how strongly, for the one-line summary. */
  summary: string;
  /** Where it had the eventual winner, 0 to 1; null draws no marker. */
  winnerWp: number | null;
  outcome: string;
  /** Good news reads in the primary colour, a miss in the loss colour. */
  tone: "hit" | "miss" | null;
  outcomeSub: string | null;
};

// Within this of a coin flip, a miss is "barely".
const BARELY = 0.05;

function callOutcome(winnerWp: number) {
  // An even 50% is no call at all, as on the home page.
  if (winnerWp === 0.5) return { outcome: "Coin flip", tone: null };
  if (winnerWp > 0.5) return { outcome: "Called it", tone: "hit" as const };
  return { outcome: winnerWp > 0.5 - BARELY ? "Missed, barely" : "Missed", tone: "miss" as const };
}

/**
 * The market, the model, and the visitor's pick before tip-off: one line, and
 * a Compare panel that puts all three on the same winner-WP axis.
 */
/** The winner's and the loser's abbreviations, for the bar and the Compare axis. */
function finalSides(game: GameDetail) {
  const homeSideWon = homeWon(game);
  return {
    homeSideWon,
    winner: (homeSideWon ? game.home_team_abbreviation : game.away_team_abbreviation) ?? "",
    loser: (homeSideWon ? game.away_team_abbreviation : game.home_team_abbreviation) ?? "",
  };
}

function pregameCalls(game: GameDetail, pick: UserPick | undefined): PregameCall[] {
  if (game.home_score == null || game.away_score == null) return [];
  const { homeSideWon, winner, loser } = finalSides(game);
  const forWinner = (homeWp: number) => (homeSideWon ? homeWp : 1 - homeWp);
  const favourite = (winnerWp: number) =>
    winnerWp === 0.5
      ? "had it even"
      : `favored ${winnerWp > 0.5 ? winner : loser} ${formatProbability(Math.max(winnerWp, 1 - winnerWp))}`;

  const calls: PregameCall[] = [];
  const market = game.market_home_wp == null ? null : forWinner(game.market_home_wp);
  if (market != null) {
    const sides: [string | null | undefined, number | null | undefined][] = [
      [game.away_team_abbreviation, game.away_moneyline],
      [game.home_team_abbreviation, game.home_moneyline],
    ];
    const prices = sides
      .flatMap(([team, price]) => (price == null ? [] : [`${team} ${formatPrice(price)}`]))
      .join(" · ");
    calls.push({
      key: "market",
      label: "Market",
      sub: "Morning line",
      summary: favourite(market),
      winnerWp: market,
      ...callOutcome(market),
      outcomeSub: prices || null,
    });
  }
  if (game.home_win_probability != null) {
    const model = forWinner(game.home_win_probability);
    const gap = market == null ? 0 : Math.round(Math.abs(model - market) * 100);
    calls.push({
      key: "model",
      label: "Model",
      sub: game.prediction_model_version ?? "Pregame estimate",
      summary: favourite(model),
      winnerWp: model,
      ...callOutcome(model),
      outcomeSub:
        market == null
          ? null
          : gap === 0
            ? "Level with the market"
            : `${gap} pts ${model > market ? "closer" : "further off"} than the market`,
    });
  }
  if (pick && (pick.result === "won" || pick.result === "lost")) {
    const pickedWinner = pick.result === "won";
    const picked = pickedWinner ? winner : loser;
    const implied = impliedProbability(pick.moneyline);
    const price = formatPrice(pick.moneyline);
    const upside =
      pick.stake != null && pick.moneyline != null ? pickProfit(pick.stake, pick.moneyline) : null;
    calls.push({
      key: "pick",
      label: "Your pick",
      sub: pick.stake != null ? `${formatMoney(pick.stake)} stake` : "No stake",
      summary: `${picked}, ${pick.result}${pick.profit != null ? ` ${formatMoney(Math.abs(pick.profit))}` : ""}`,
      winnerWp: implied == null ? null : pickedWinner ? implied : 1 - implied,
      outcome: `${pickedWinner ? "Won" : "Lost"}${pick.profit != null ? ` · ${formatSignedMoney(pick.profit)}` : ""}`,
      tone: pickedWinner ? "hit" : "miss",
      outcomeSub:
        upside == null
          ? price
            ? `At ${price}`
            : null
          : pickedWinner
            ? `At ${price}`
            : `Would have won ${formatMoney(upside)}`,
    });
  }
  return calls;
}

function PregameCalls({ game, pick }: { game: GameDetail; pick: UserPick | undefined }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const calls = pregameCalls(game, pick);
  if (calls.length === 0) return null;
  const upset = isUpsetWin(game.winner_market_wp);
  const { winner, loser } = finalSides(game);
  const tone = (call: PregameCall) =>
    call.tone === "hit" ? "text-primary" : call.tone === "miss" ? "text-destructive" : "";
  return (
    <div className="border-b border-rule" data-testid="pregame-calls">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-1 py-3 text-left text-sm text-ink-2 hover:bg-row-hover",
          open && "bg-row-hover"
        )}
      >
        {upset ? (
          <span
            data-testid="upset-tag"
            title={`The market gave ${winner} a ${formatProbability(game.winner_market_wp)} chance`}
            className="type-eyebrow self-center border border-ink px-1 tracking-normal text-ink"
          >
            Upset
          </span>
        ) : null}
        <span className="font-semibold text-foreground">Before tip-off</span>
        {calls.map((call, index) => (
          <Fragment key={call.key}>
            {index > 0 ? <span className="text-ink-3">·</span> : null}
            <span data-testid="recap-call">
              {call.label}{" "}
              <span className={cn(call.key === "pick" && tone(call))}>{call.summary}</span>
            </span>
          </Fragment>
        ))}
        <span className="ml-auto text-primary">
          {open ? "Hide" : "Compare"} <span aria-hidden>{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open ? (
        <div id={panelId} className="pb-3">
          <div className="type-eyebrow grid grid-cols-[8rem_minmax(0,1fr)_10rem] gap-x-6 border-b border-rule-soft py-2 sm:grid-cols-[10rem_minmax(0,1fr)_12rem]">
            <span />
            <span className="flex justify-between">
              <span>{loser}</span>
              <span>50/50</span>
              <span>{winner}</span>
            </span>
            <span className="text-right">Outcome</span>
          </div>
          {calls.map((call) => (
            <div
              key={call.key}
              data-testid="pregame-row"
              className="grid grid-cols-[8rem_minmax(0,1fr)_10rem] items-center gap-x-6 border-b border-rule-soft py-3 sm:grid-cols-[10rem_minmax(0,1fr)_12rem]"
            >
              <div>
                <p className="font-semibold">{call.label}</p>
                <p className="type-caption">{call.sub}</p>
              </div>
              <WinnerMeter value={call.winnerWp} />
              <div className="text-right">
                <p className={cn("font-semibold", tone(call))}>{call.outcome}</p>
                {call.outcomeSub ? <p className="type-caption">{call.outcomeSub}</p> : null}
              </div>
            </div>
          ))}
          <p className="type-caption pt-3">
            Market is the vig-free morning line. Model is Baseline&apos;s pregame estimate.{" "}
            <Link href="/predictions" className="text-primary hover:underline">
              How accurate is the model?
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** A dot at the winner's WP on a loser-to-winner track, shaded back to 50/50. */
function WinnerMeter({ value }: { value: number | null }) {
  const percent = value == null ? null : Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div className="relative h-4" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px bg-rule" />
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-ink-3" />
      {percent == null ? null : (
        <>
          <div
            className="absolute top-1/2 h-[3px] -translate-y-1/2 bg-rule-strong opacity-40"
            style={{ left: `${Math.min(percent, 50)}%`, width: `${Math.abs(percent - 50)}%` }}
          />
          <div
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
            style={{ left: `${percent}%` }}
          />
        </>
      )}
    </div>
  );
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
