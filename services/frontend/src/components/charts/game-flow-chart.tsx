"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/query-state";
import {
  flowTooltipScoreParts,
  formatFlowTooltipLabel,
  formatFlowTooltipPlay,
  formatLead,
  formatRunSpan,
  periodLabel,
  quarterAxisTicks,
  selectBiggestRun,
  type BiggestRun,
} from "@/lib/game-flow";
import {
  CHART_BACKGROUND,
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
const INK = "#1A1A1A";
const INK_2 = "#5C574F";

/** The biggest run as the chart draws it: its plays, where it starts and ends, and its words. */
export type RunMark = {
  title: string;
  detail: string;
  color: string;
  /** The home team's run climbs the chart; the away team's falls. */
  rising: boolean;
  anchor: ChartPoint;
  last: ChartPoint;
  plays: ChartPoint[];
};

// `colors` is optional because recharts clones this element to inject
// active/payload; the fallback is the same neutral pair the plot starts from.
export function GameFlowTooltip({
  active,
  payload,
  colors = resolvePlotColors({}),
  run,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ChartPoint; value?: unknown }>;
  colors?: PlotColors;
  run?: RunMark | null;
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
      {run && point.in_run ? <RunPlays run={run} active={point} colors={colors} /> : null}
    </div>
  );
}

// Recharts may hand the tooltip a copy of the point, so match on the play, not the object.
function samePlay(a: ChartPoint, b: ChartPoint): boolean {
  return (
    a.elapsed_seconds === b.elapsed_seconds &&
    a.score_home === b.score_home &&
    a.score_away === b.score_away
  );
}

/** Every scoring play of the run, under the hovered one, which is set in bold. */
function RunPlays({
  run,
  active,
  colors,
}: {
  run: RunMark;
  active: ChartPoint;
  colors: PlotColors;
}) {
  return (
    <div
      data-testid="run-plays"
      style={{ borderTop: "1px solid #D8D3C6", marginTop: 6, paddingTop: 6, fontSize: 12 }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>
        {run.title} <span style={{ color: INK_2, fontWeight: 400 }}>{run.detail}</span>
      </p>
      {run.plays.map((play, index) => {
        const score = flowTooltipScoreParts(play.score_differential, play);
        return (
          <p
            key={index}
            style={{ margin: 0, paddingTop: 2, fontWeight: samePlay(play, active) ? 600 : 400 }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: 3,
                marginRight: 6,
                background: colorForScoringSide(play.scoring_side, colors),
              }}
            />
            {[formatFlowTooltipLabel(play), formatFlowTooltipPlay(play)]
              .filter(Boolean)
              .join(" · ")}
            <span style={{ color: INK_2 }}>
              {` · ${score.away} ${score.scoreAway}–${score.home} ${score.scoreHome}`}
            </span>
          </p>
        );
      })}
    </div>
  );
}

export type ChartPoint = {
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
  /** A scoring play of the biggest run. */
  in_run?: boolean;
  /** The differential on the run's stretch of the line (its start point included), else null. */
  run_differential?: number | null;
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

/** Height of the lane under the time axis that holds the run's bracket and label. */
const RUN_LANE = 52;

/** Axis-aligned extras recharts has no component for: the "ahead" labels and the run's guides, bracket and label. */
function FlowOverlay({
  yMax,
  homeAhead,
  awayAhead,
  run,
}: {
  yMax: number;
  homeAhead: string;
  awayAhead: string;
  run: RunMark | null;
}) {
  const plot = usePlotArea();
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!plot || !xScale || !yScale) return null;
  const top = yScale(yMax);
  const bottom = yScale(-yMax);
  if (top == null || bottom == null) return null;
  const left = plot.x + 6;
  const axisY = plot.y + plot.height;

  let runMarks = null;
  const x1 = run ? xScale(run.anchor.elapsed_seconds) : null;
  const x2 = run ? xScale(run.last.elapsed_seconds) : null;
  const y1 = run ? yScale(run.anchor.score_differential) : null;
  const y2 = run ? yScale(run.last.score_differential) : null;
  if (run && x1 != null && x2 != null && y1 != null && y2 != null) {
    // Below the quarter labels, which sit just under the axis line.
    const bracketY = axisY + RUN_LANE - 18;
    // SVG text has no layout, so estimate the label's width from its length and
    // keep it centred under the bracket without running off either edge.
    const halfLabel = ((run.title.length + run.detail.length + 3) * 7) / 2;
    const labelX = Math.min(
      Math.max((x1 + x2) / 2, halfLabel),
      Math.max(plot.x + plot.width - halfLabel, halfLabel)
    );
    runMarks = (
      <g data-testid="run-marks">
        {[
          [x1, y1],
          [x2, y2],
        ].map(([x, y], index) => (
          <line
            key={index}
            x1={x}
            x2={x}
            y1={y + 7}
            y2={axisY}
            stroke={TIED_COLOR}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ))}
        <path
          d={`M${x1},${bracketY - 6}V${bracketY}H${x2}V${bracketY - 6}`}
          fill="none"
          stroke={run.color}
          strokeWidth={2}
        />
        <text x={labelX} y={bracketY + 20} textAnchor="middle" fontSize={14} fill={INK_2}>
          <tspan fill={INK} fontWeight={600}>
            {run.title}
          </tspan>
          {` · ${run.detail}`}
        </text>
      </g>
    );
  }

  return (
    <g>
      <text x={left} y={top - 5} fill={INK_2} fontSize={12}>
        {homeAhead}
      </text>
      <text x={left} y={bottom - 5} fill={INK_2} fontSize={12}>
        {awayAhead}
      </text>
      {runMarks}
    </g>
  );
}

/** Everything the chart draws, shaped from the play-by-play; null when there is nothing to plot. */
export function flowChartModel(
  events: PlayByPlayEvent[],
  flow?: GameFlow | null,
  biggestRun: BiggestRun | null = selectBiggestRun(events, {
    homeAbbreviation: flow?.home_team_abbreviation,
    awayAbbreviation: flow?.away_team_abbreviation,
  })
) {
  const teams = {
    homeAbbreviation: flow?.home_team_abbreviation,
    awayAbbreviation: flow?.away_team_abbreviation,
  };
  const data = toPoints(events, teams);
  if (data.length === 0) return null;

  const maxPeriod = Math.max(
    flow?.game_elapsed_seconds && flow.game_elapsed_seconds > 2880 ? 5 : 4,
    ...data.map((point) => point.period ?? 4)
  );
  const plotColors = resolvePlotColors({
    homePrimary: flow?.home_primary_color,
    homeAlternate: flow?.home_alternate_color,
    awayPrimary: flow?.away_primary_color,
    awayAlternate: flow?.away_alternate_color,
  });

  // Symmetric around a tie, in steps of 5 (10 for a blowout), with headroom
  // past the last gridline for the "ahead" labels.
  const largest = Math.max(...data.map((point) => Math.abs(point.score_differential)), 1);
  const step = largest > 20 ? 10 : 5;
  const yMax = Math.ceil(largest / step) * step;
  const yTicks = Array.from({ length: (2 * yMax) / step + 1 }, (_, index) => -yMax + index * step);

  const span = biggestRunSpan(biggestRun, events, data, teams);
  const points: ChartPoint[] = span
    ? data.map((point, index) => ({
        ...point,
        in_run: index >= span.firstPlay && index <= span.lastPlay,
        run_differential:
          index >= span.anchor && index <= span.lastPlay ? point.score_differential : null,
      }))
    : data;

  return {
    teams,
    home: teams.homeAbbreviation || "Home",
    away: teams.awayAbbreviation || "Away",
    ticks: quarterAxisTicks(maxPeriod),
    plotColors,
    yMax,
    yDomain: [-yMax - step * 0.35, yMax + step * 0.35] as [number, number],
    yTicks,
    points,
    run: span ? runMark(span, points, plotColors) : null,
  };
}

export function GameFlowChart({
  events,
  flow,
  run: biggestRun,
}: {
  events: PlayByPlayEvent[];
  flow?: GameFlow | null;
  /** The run the page already picked, so the chart and the words around it agree; picked here when absent. */
  run?: BiggestRun | null;
}) {
  const model =
    biggestRun === undefined
      ? flowChartModel(events, flow)
      : flowChartModel(events, flow, biggestRun);
  if (!model) {
    return (
      <EmptyState
        title="No PBP data available."
        message="There's no scoring timeline for this game."
      />
    );
  }
  const { teams, home, away, ticks, plotColors, yMax, yDomain, yTicks, points, run } = model;

  const dot = (radius: number) =>
    function ScoringDot(props: { cx?: number; cy?: number; payload?: ChartPoint }) {
      const fill = colorForScoringSide(props.payload?.scoring_side, plotColors);
      return <circle cx={props.cx} cy={props.cy} r={radius} fill={fill} stroke={fill} />;
    };
  const endpoint = (point: ChartPoint, above: boolean) => (
    <ReferenceDot
      x={point.elapsed_seconds}
      y={point.score_differential}
      r={6}
      fill={CHART_BACKGROUND}
      stroke={INK}
      strokeWidth={1.5}
      label={{
        value: formatLead(point.score_differential, teams),
        position: above ? "top" : "bottom",
        offset: 8,
        fill: INK,
        fontSize: 13,
        fontWeight: 600,
      }}
    />
  );

  return (
    <div>
      <div className="flex flex-wrap gap-x-5 text-sm text-ink-2" data-testid="flow-legend">
        {[
          { label: away, color: plotColors.away },
          { label: home, color: plotColors.home },
        ].map((side) => (
          <span key={side.label} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: side.color }} aria-hidden />
            {side.label} scores
          </span>
        ))}
      </div>
      <div className={run ? "h-[460px] w-full" : "h-[420px] w-full"}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            margin={{ top: 16, right: 16, left: 8, bottom: run ? 8 + RUN_LANE : 8 }}
          >
            <CartesianGrid stroke="#E6E1D5" vertical={false} />
            <XAxis
              type="number"
              dataKey="elapsed_seconds"
              ticks={ticks.map((tick) => tick.seconds)}
              tickFormatter={(value) =>
                ticks.find((tick) => tick.seconds === value)?.label ?? periodLabel(1)
              }
              tick={{ fill: INK_2, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: INK_2 }}
            />
            <YAxis
              type="number"
              domain={yDomain}
              ticks={yTicks}
              tickFormatter={(value: number) => (value === 0 ? "0" : `+${Math.abs(value)}`)}
              tick={{ fill: INK_2, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <ReferenceLine y={0} stroke="#A39C8C" strokeDasharray="4 4" />
            <Tooltip content={<GameFlowTooltip colors={plotColors} run={run} />} />
            <Line
              type="linear"
              dataKey="score_differential"
              stroke={FLOW_LINE_COLOR}
              strokeWidth={1.5}
              dot={dot(3)}
              activeDot={dot(5)}
              isAnimationActive={false}
            />
            {run ? (
              <Line
                type="linear"
                dataKey="run_differential"
                stroke={run.color}
                strokeWidth={3.5}
                dot={false}
                activeDot={false}
                tooltipType="none"
                isAnimationActive={false}
              />
            ) : null}
            {run ? endpoint(run.anchor, !run.rising) : null}
            {run ? endpoint(run.last, run.rising) : null}
            <FlowOverlay
              yMax={yMax}
              homeAhead={`${home} ahead`}
              awayAhead={`${away} ahead`}
              run={run}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type RunSpan = {
  run: BiggestRun;
  /** Indices into the chart points: where the run starts from, then its first and last play. */
  anchor: number;
  firstPlay: number;
  lastPlay: number;
  isAway: boolean;
};

function biggestRunSpan(
  run: BiggestRun | null,
  events: PlayByPlayEvent[],
  data: ChartPoint[],
  teams: { homeAbbreviation?: string | null; awayAbbreviation?: string | null }
): RunSpan | null {
  if (!run) return null;
  // `data` may open with a synthetic tip-off point the events do not have.
  const offset = data.length - events.length;
  const firstPlay = run.biggest_run_start_index + offset;
  const lastPlay = run.biggest_run_end_index + offset;
  const anchor = Math.max(firstPlay - 1, 0);
  if (lastPlay <= anchor || lastPlay >= data.length) return null;
  return {
    run,
    anchor,
    firstPlay,
    lastPlay,
    isAway: run.biggest_run_team_abbreviation === (teams.awayAbbreviation || "Away"),
  };
}

function runMark(span: RunSpan, points: ChartPoint[], colors: PlotColors): RunMark {
  const { run } = span;
  const anchor = points[span.anchor];
  const last = points[span.lastPlay];
  const swing = run.biggest_run_winner_points - run.biggest_run_opponent_points;
  return {
    title: `${run.biggest_run_label} run`,
    detail: `${formatRunSpan(anchor, last)} · ${swing}-pt swing`,
    color: span.isAway ? colors.away : colors.home,
    rising: !span.isAway,
    anchor,
    last,
    plays: points.slice(span.firstPlay, span.lastPlay + 1),
  };
}
