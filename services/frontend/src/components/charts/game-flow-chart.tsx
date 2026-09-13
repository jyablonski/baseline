"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/query-state";
import {
  formatBiggestRunCaption,
  flowTooltipScoreParts,
  formatFlowTooltipLabel,
  formatFlowTooltipPlay,
  periodLabel,
  quarterAxisTicks,
  selectBiggestRun,
} from "@/lib/game-flow";
import {
  colorForScoringSide,
  type PlotColors,
  resolvePlotColors,
  TIED_COLOR,
} from "@/lib/team-colors";
import type { GameFlow, PlayByPlayEvent } from "@/lib/types";

const tooltipStyle = {
  background: "#FBFAF5",
  border: "1px solid #D8D3C6",
  borderRadius: 0,
  color: "#1A1A1A",
  margin: 0,
  padding: "10px",
  whiteSpace: "nowrap" as const,
};

const FLOW_LINE_COLOR = TIED_COLOR;

// `colors` is optional because recharts clones this element to inject
// active/payload; the fallback is the same neutral pair the plot starts from.
export function GameFlowTooltip({
  active,
  payload,
  colors = resolvePlotColors({}),
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ChartPoint; value?: unknown }>;
  colors?: PlotColors;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const play = formatFlowTooltipPlay(point);
  const score = flowTooltipScoreParts(point.score_differential, point);
  return (
    <div className="recharts-default-tooltip" style={tooltipStyle}>
      <p className="recharts-tooltip-label" style={{ margin: 0 }}>
        {formatFlowTooltipLabel(point)}
      </p>
      <p className="recharts-tooltip-item" style={{ margin: 0, paddingTop: 4, paddingBottom: 4 }}>
        <span className="recharts-tooltip-item-name">Score</span>
        <span className="recharts-tooltip-item-separator"> : </span>
        <span className="recharts-tooltip-item-value">
          <span style={{ color: colors.away, fontWeight: 600 }}>{score.away}</span>
          {` ${score.scoreAway} – `}
          <span style={{ color: colors.home, fontWeight: 600 }}>{score.home}</span>
          {` ${score.scoreHome} (${score.signed})`}
        </span>
      </p>
      {play ? (
        <p className="recharts-tooltip-item" style={{ margin: 0, paddingTop: 4, paddingBottom: 4 }}>
          {play}
        </p>
      ) : null}
    </div>
  );
}

type ChartPoint = {
  elapsed_seconds: number;
  score_differential: number;
  score_home: number;
  score_away: number;
  period: number | null;
  clock: string | null;
  clock_remaining_seconds: number | null;
  scoring_side: string | null;
  player_name: string | null;
  action_type: string | null;
  sub_type: string | null;
  description: string | null;
  away_abbreviation?: string | null;
  home_abbreviation?: string | null;
};

function toPoints(
  events: PlayByPlayEvent[],
  teams?: { awayAbbreviation?: string | null; homeAbbreviation?: string | null }
): ChartPoint[] {
  const mapped = events.map((event) => ({
    elapsed_seconds: event.elapsed_seconds,
    score_differential: event.score_differential,
    score_home: event.score_home,
    score_away: event.score_away,
    period: event.period,
    clock: event.clock,
    clock_remaining_seconds: event.clock_remaining_seconds ?? null,
    scoring_side: event.scoring_side ?? null,
    player_name: event.player_name ?? null,
    action_type: event.action_type ?? null,
    sub_type: event.sub_type ?? null,
    description: event.description ?? null,
    away_abbreviation: teams?.awayAbbreviation ?? null,
    home_abbreviation: teams?.homeAbbreviation ?? null,
  }));
  if (mapped.length === 0) return mapped;
  if (mapped[0].elapsed_seconds > 0 || mapped[0].score_differential !== 0) {
    return [
      {
        elapsed_seconds: 0,
        score_differential: 0,
        score_home: 0,
        score_away: 0,
        period: 1,
        clock: "12:00",
        clock_remaining_seconds: 720,
        scoring_side: null,
        player_name: null,
        action_type: null,
        sub_type: null,
        description: "Tip-off",
        away_abbreviation: teams?.awayAbbreviation ?? null,
        home_abbreviation: teams?.homeAbbreviation ?? null,
      },
      ...mapped,
    ];
  }
  return mapped;
}

export function GameFlowChart({
  events,
  flow,
}: {
  events: PlayByPlayEvent[];
  flow?: GameFlow | null;
}) {
  const teams = {
    homeAbbreviation: flow?.home_team_abbreviation,
    awayAbbreviation: flow?.away_team_abbreviation,
  };
  const data = toPoints(events, teams);
  if (data.length === 0) {
    return (
      <EmptyState
        title="No PBP data available."
        message="There's no scoring timeline for this game."
      />
    );
  }

  const maxPeriod = Math.max(
    flow?.game_elapsed_seconds && flow.game_elapsed_seconds > 2880 ? 5 : 4,
    ...data.map((point) => point.period ?? 4)
  );
  const ticks = quarterAxisTicks(maxPeriod);
  const biggestRun = selectBiggestRun(events, teams);
  const caption = biggestRun ? formatBiggestRunCaption(biggestRun) : null;
  const runStart = biggestRun?.biggest_run_start_seconds;
  const runEnd = biggestRun?.biggest_run_end_seconds;
  const showRun = caption != null && runStart != null && runEnd != null && runEnd > runStart;
  const plotColors = resolvePlotColors({
    homePrimary: flow?.home_primary_color,
    homeAlternate: flow?.home_alternate_color,
    awayPrimary: flow?.away_primary_color,
    awayAlternate: flow?.away_alternate_color,
  });
  const runColor =
    biggestRun?.biggest_run_team_abbreviation &&
    biggestRun.biggest_run_team_abbreviation === teams.awayAbbreviation
      ? plotColors.away
      : plotColors.home;

  return (
    <div>
      <div className="h-[420px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid stroke="#D8D3C6" />
            <XAxis
              type="number"
              dataKey="elapsed_seconds"
              ticks={ticks.map((tick) => tick.seconds)}
              tickFormatter={(value) =>
                ticks.find((tick) => tick.seconds === value)?.label ?? periodLabel(1)
              }
              tick={{ fill: "#5C574F", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              label={{ value: "Quarter", position: "insideBottom", offset: -2, fill: "#5C574F" }}
            />
            <YAxis
              tick={{ fill: "#5C574F", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={44}
              label={{
                value: "Score Differential",
                angle: -90,
                position: "insideLeft",
                fill: "#5C574F",
                style: { textAnchor: "middle" },
              }}
            />
            <ReferenceLine y={0} stroke="#A39C8C" strokeDasharray="4 4" />
            {showRun ? (
              <ReferenceArea
                x1={runStart}
                x2={runEnd}
                fill={runColor}
                fillOpacity={0.18}
                label={{
                  value: caption,
                  position: "insideTop",
                  fill: "#1A1A1A",
                  fontSize: 12,
                }}
              />
            ) : null}
            <Tooltip content={<GameFlowTooltip colors={plotColors} />} />
            <Line
              type="linear"
              data={data}
              dataKey="score_differential"
              stroke={FLOW_LINE_COLOR}
              strokeWidth={2}
              dot={(props: { cx?: number; cy?: number; payload?: ChartPoint }) => {
                const fill = colorForScoringSide(props.payload?.scoring_side, plotColors);
                return <circle cx={props.cx} cy={props.cy} r={3} fill={fill} stroke={fill} />;
              }}
              activeDot={(props: { cx?: number; cy?: number; payload?: ChartPoint }) => {
                const fill = colorForScoringSide(props.payload?.scoring_side, plotColors);
                return <circle cx={props.cx} cy={props.cy} r={5} fill={fill} stroke={fill} />;
              }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {caption ? <p className="type-caption mt-2">{caption}</p> : null}
    </div>
  );
}
