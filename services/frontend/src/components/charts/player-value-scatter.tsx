"use client";

import { memo } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  DefaultZIndexes,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  YAxis,
  ZIndexLayer,
} from "recharts";

import { formatStat, formatUsdMillions } from "@/lib/format";
import { type Box, estimateTextWidth, type LabelRequest, placeLabels } from "@/lib/label-layout";
import { playerHref } from "@/lib/nav";
import {
  axisTicks,
  isPicked,
  median,
  plotLabel,
  VALUE_CATEGORIES,
  type PlayerValuePoint,
  type ValueCategory,
} from "@/lib/player-value";

const tooltipStyle = {
  background: "#FBFAF5",
  border: "1px solid #D8D3C6",
  borderRadius: 0,
  color: "#1A1A1A",
  padding: "8px 10px",
};

const tickStyle = { fill: "#5C574F", fontSize: 12 };
const axisLabelStyle = { fill: "#5C574F", fontSize: 12 };

const CATEGORY_COLOR = Object.fromEntries(
  VALUE_CATEGORIES.map((category) => [category.key, category.color])
) as Record<ValueCategory, string>;
const CATEGORY_LABEL = Object.fromEntries(
  VALUE_CATEGORIES.map((category) => [category.key, category.label])
) as Record<ValueCategory, string>;

// Where each median line's label sits, from the point recharts hands it: the
// salary label beside the top of its line, the score label above the right end
// of its. PlayerLabels keeps names off the same boxes, so both read these.
const MEDIAN_LABEL = { fontSize: 11, inset: 5, rightInset: 4, top: 12, above: 5 };

const PLOT_MARGIN = { top: 12, right: 96, bottom: 16, left: 8 };

export type PlottedPlayer = PlayerValuePoint & {
  /** Named on the plot: an MVP candidate, or one the reader picked. */
  labelled: boolean;
  /** Picked by the reader, through a team or by name: drawn larger and ringed. */
  picked?: boolean;
  /** Faded because the reader picked other players or teams. */
  dimmed: boolean;
};

export function PlayerDot({
  cx,
  cy,
  payload,
}: {
  cx?: number;
  cy?: number;
  payload?: PlottedPlayer;
}) {
  if (cx == null || cy == null || payload == null) return null;
  const color = CATEGORY_COLOR[payload.category];
  const quiet = payload.category === "fair" && !payload.labelled;
  // A pick has a look nothing else on the plot uses, so it reads as the reader's
  // choice rather than as one more MVP candidate: bigger, with a dark ring held
  // off the dot by a paper-coloured gap.
  const picked = payload.picked === true;
  return (
    <a href={playerHref(payload.full_name)} aria-label={payload.full_name}>
      {picked ? (
        <circle
          cx={cx}
          cy={cy}
          r={11}
          fill="none"
          stroke="#1A1A1A"
          strokeWidth={1.5}
          data-testid="pick-ring"
        />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={picked ? 7.5 : payload.labelled ? 6 : 4.5}
        fill={color}
        fillOpacity={payload.dimmed ? 0.18 : quiet ? 0.7 : 1}
        stroke="#FBFAF5"
        strokeWidth={picked ? 2 : 1}
        strokeOpacity={payload.dimmed ? 0.18 : 1}
      />
    </a>
  );
}

export function PlayerValueTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: PlottedPlayer }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div style={tooltipStyle}>
      <p style={{ margin: 0, fontWeight: 600 }}>
        {point.full_name}
        {point.team_abbreviation ? ` · ${point.team_abbreviation}` : ""}
      </p>
      <p style={{ margin: 0, paddingTop: 4 }}>
        MVP Score: {formatStat(point.mvp_score)} (#{point.mvp_rank}) ·{" "}
        {formatUsdMillions(point.salary)}
      </p>
      <p style={{ margin: 0, paddingTop: 2, color: "#5C574F" }}>
        {/* Average's dot color is too pale to read as text, so it keeps the muted line color. */}
        <span
          style={
            point.category === "fair"
              ? undefined
              : { color: CATEGORY_COLOR[point.category], fontWeight: 600 }
          }
        >
          {CATEGORY_LABEL[point.category]}
        </span>{" "}
        · {point.games_played} games
      </p>
    </div>
  );
}

/**
 * Every name on the plot, laid out together so two candidates with near-equal
 * scores and pay do not print over each other. Above the dots, like recharts'
 * own labels. A name moved off its dot's line gets a hairline back to it.
 */
function PlayerLabels({
  players,
  medians,
}: {
  players: PlottedPlayer[];
  /** Each median line's position (salary in millions, as plotted) and its label's text. */
  medians: { salary: number; salaryLabel: string; score: number; scoreLabel: string };
}) {
  const plot = usePlotArea();
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!plot || !xScale || !yScale) return null;

  // Picks claim their spot first, then candidates from the top of the ladder.
  const labelled = players
    .filter((player) => player.labelled)
    .sort(
      (left, right) =>
        Number(right.picked === true) - Number(left.picked === true) ||
        left.mvp_rank - right.mvp_rank
    );
  const requests: (LabelRequest & { player: PlottedPlayer })[] = labelled.flatMap((player) => {
    const x = xScale(player.salary_millions);
    const y = yScale(player.mvp_score);
    if (x == null || y == null) return [];
    const picked = player.picked === true;
    return [
      {
        id: player.player_id,
        x,
        y,
        text: plotLabel(player.full_name),
        gap: picked ? 15 : 9,
        fontSize: picked ? 13 : 12,
        bold: picked,
        player,
      },
    ];
  });
  // Names also keep off the named dots themselves and the two median labels.
  const dots: Box[] = requests.map((request) => {
    const radius = request.player.picked ? 12 : 7;
    return {
      left: request.x - radius,
      right: request.x + radius,
      top: request.y - radius,
      bottom: request.y + radius,
    };
  });
  const medianX = xScale(medians.salary);
  const medianY = yScale(medians.score);
  const { fontSize, inset, rightInset, top, above } = MEDIAN_LABEL;
  const medianLabels: Box[] = [];
  if (medianX != null) {
    medianLabels.push({
      left: medianX,
      right: medianX + inset + estimateTextWidth(medians.salaryLabel, fontSize),
      top: plot.y,
      bottom: plot.y + top + 3,
    });
  }
  if (medianY != null) {
    const right = plot.x + plot.width;
    medianLabels.push({
      left: right - rightInset - estimateTextWidth(medians.scoreLabel, fontSize),
      right,
      top: medianY - above - fontSize - 1,
      bottom: medianY,
    });
  }
  const placed = placeLabels(
    requests,
    {
      left: plot.x,
      // The chart's right margin is there so names on the priciest players fit.
      right: plot.x + plot.width + PLOT_MARGIN.right - 4,
      top: plot.y - PLOT_MARGIN.top,
      bottom: plot.y + plot.height,
    },
    [...dots, ...medianLabels]
  );

  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g data-testid="player-labels">
        {placed.map((spot, index) => {
          const { player, x, y, fontSize, bold } = requests[index];
          const toward = spot.anchor === "start" ? -3 : 3;
          return (
            <g key={spot.id}>
              {spot.leader ? (
                <line
                  x1={x}
                  y1={y}
                  x2={spot.x + toward}
                  y2={spot.y - fontSize / 3}
                  stroke="#8C8577"
                  strokeWidth={0.75}
                  data-testid="label-leader"
                />
              ) : null}
              {/* The dot is the link a screen reader hears; the name is a second, mouse-only target. */}
              <a href={playerHref(player.full_name)} aria-hidden="true" tabIndex={-1}>
                <text
                  x={spot.x}
                  y={spot.y}
                  textAnchor={spot.anchor}
                  fontSize={fontSize}
                  fontWeight={bold ? 700 : 500}
                  fill="#1A1A1A"
                  // A paper-coloured halo keeps a name readable over the dots behind it.
                  stroke="#F4F1EA"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {plotLabel(player.full_name)}
                </text>
              </a>
            </g>
          );
        })}
      </g>
    </ZIndexLayer>
  );
}

function renderDot(props: { cx?: number; cy?: number; payload?: PlottedPlayer }) {
  return <PlayerDot cx={props.cx} cy={props.cy} payload={props.payload} />;
}

/** Names a median line where it meets the plot's edge, haloed like the player names. */
function MedianLabel({
  viewBox,
  value,
  along,
}: {
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
  value: string;
  /** "vertical" sits at the top beside the line; "horizontal" at the right, above it. */
  along: "vertical" | "horizontal";
}) {
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  const vertical = along === "vertical";
  return (
    <text
      x={vertical ? x + MEDIAN_LABEL.inset : x + (viewBox?.width ?? 0) - MEDIAN_LABEL.rightInset}
      y={vertical ? y + MEDIAN_LABEL.top : y - MEDIAN_LABEL.above}
      textAnchor={vertical ? "start" : "end"}
      fontSize={MEDIAN_LABEL.fontSize}
      fill="#5C574F"
      stroke="#F4F1EA"
      strokeWidth={3}
      paintOrder="stroke"
    >
      {value}
    </text>
  );
}

// Memoised: the plot is a few hundred custom SVG nodes, so it should redraw
// only when the points or the picks change, not whenever its parent does.
export const PlayerValueScatter = memo(function PlayerValueScatter({
  points,
  teams,
  players,
}: {
  points: PlayerValuePoint[];
  teams: ReadonlySet<string>;
  players: ReadonlySet<string>;
}) {
  if (points.length === 0) return null;
  const picking = teams.size > 0 || players.size > 0;
  const plotted: PlottedPlayer[] = points
    .map((point) => {
      const picked = isPicked(point, teams, players);
      return {
        ...point,
        labelled: picking ? picked : point.category === "mvp",
        picked,
        dimmed: picking && !picked,
      };
    })
    // SVG paints in order: labelled players' dots last so other dots do not
    // cover them, and picks after those. Names are drawn above all of it.
    .sort(
      (left, right) =>
        Number(left.labelled) - Number(right.labelled) || Number(left.picked) - Number(right.picked)
    );

  const scores = points.map((point) => point.mvp_score);
  const scoreTicks = axisTicks(Math.min(0, ...scores), Math.max(...scores), 5);
  const salaryTicks = axisTicks(0, Math.max(...points.map((point) => point.salary_millions)), 10);
  const medianSalary = median(points.map((point) => point.salary));
  const medianScore = median(scores);
  const salaryLabel = `Median salary ${formatUsdMillions(medianSalary)}`;
  const scoreLabel = `Median MVP score ${formatStat(medianScore)}`;

  return (
    <div className="h-[340px] w-full sm:h-[440px]">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart width={640} height={420} margin={PLOT_MARGIN}>
          {/* Solid and faint, so the dashed medians are the only dashed lines. */}
          <CartesianGrid stroke="#E6E1D5" />
          <XAxis
            type="number"
            dataKey="salary_millions"
            name="Salary"
            domain={[salaryTicks[0], salaryTicks[salaryTicks.length - 1]]}
            ticks={salaryTicks}
            tick={tickStyle}
            tickFormatter={(value: number) => `$${Math.round(value)}M`}
            tickLine={false}
            axisLine={false}
            label={{
              value: "Salary",
              position: "insideBottom",
              offset: -8,
              style: axisLabelStyle,
            }}
          />
          <YAxis
            type="number"
            dataKey="mvp_score"
            name="MVP score"
            domain={[scoreTicks[0], scoreTicks[scoreTicks.length - 1]]}
            ticks={scoreTicks}
            tick={tickStyle}
            tickFormatter={(value: number) => String(Math.round(value))}
            tickLine={false}
            axisLine={false}
            width={44}
            label={{
              value: "MVP score",
              angle: -90,
              position: "insideLeft",
              style: axisLabelStyle,
            }}
          />
          <ReferenceLine
            x={medianSalary / 1_000_000}
            stroke="#8C8577"
            strokeDasharray="5 4"
            label={<MedianLabel along="vertical" value={salaryLabel} />}
          />
          <ReferenceLine
            y={medianScore}
            stroke="#8C8577"
            strokeDasharray="5 4"
            label={<MedianLabel along="horizontal" value={scoreLabel} />}
          />
          <Tooltip
            content={<PlayerValueTooltip />}
            cursor={{ stroke: "#D8D3C6", strokeDasharray: "4 4" }}
            isAnimationActive={false}
            animationDuration={0}
          />
          <Scatter
            data={plotted}
            shape={renderDot}
            activeShape={renderDot}
            legendType="none"
            isAnimationActive={false}
          />
          <PlayerLabels
            players={plotted}
            medians={{
              salary: medianSalary / 1_000_000,
              salaryLabel,
              score: medianScore,
              scoreLabel,
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
});
