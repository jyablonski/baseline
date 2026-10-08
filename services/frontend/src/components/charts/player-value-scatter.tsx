"use client";

import { memo } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatStat, formatUsdMillions } from "@/lib/format";
import { playerHref } from "@/lib/nav";
import {
  axisTicks,
  isPicked,
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

export type PlottedPlayer = PlayerValuePoint & {
  /** Named on the plot: an MVP candidate, or one the reader picked. */
  labelled: boolean;
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
  return (
    <a href={playerHref(payload.full_name)} aria-label={payload.full_name}>
      <circle
        cx={cx}
        cy={cy}
        r={payload.labelled ? 6 : 4.5}
        fill={color}
        fillOpacity={payload.dimmed ? 0.18 : quiet ? 0.7 : 1}
        stroke={payload.labelled ? "#1A1A1A" : "#FBFAF5"}
        strokeWidth={1}
        strokeOpacity={payload.dimmed ? 0.18 : 1}
      />
      {payload.labelled ? (
        <text
          x={cx + 9}
          y={cy + 4}
          fontSize={12}
          fontWeight={500}
          fill="#1A1A1A"
          // A paper-coloured halo keeps a name readable over the dots behind it.
          stroke="#F4F1EA"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {plotLabel(payload.full_name)}
        </text>
      ) : null}
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
        MVP {formatStat(point.mvp_score)} (#{point.mvp_rank}) · {formatUsdMillions(point.salary)}
      </p>
      <p style={{ margin: 0, paddingTop: 2, color: "#5C574F" }}>
        {CATEGORY_LABEL[point.category]} · {point.games_played} games
      </p>
    </div>
  );
}

function renderDot(props: { cx?: number; cy?: number; payload?: PlottedPlayer }) {
  return <PlayerDot cx={props.cx} cy={props.cy} payload={props.payload} />;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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
        dimmed: picking && !picked,
      };
    })
    // SVG paints in order: labelled players last so their names sit on top.
    .sort((left, right) => Number(left.labelled) - Number(right.labelled));

  const scores = points.map((point) => point.mvp_score);
  const scoreTicks = axisTicks(Math.min(0, ...scores), Math.max(...scores), 5);
  const salaryTicks = axisTicks(0, Math.max(...points.map((point) => point.salary_millions)), 10);

  return (
    <div className="h-[340px] w-full sm:h-[440px]">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart width={640} height={420} margin={{ top: 12, right: 96, bottom: 16, left: 8 }}>
          <CartesianGrid stroke="#D8D3C6" strokeDasharray="3 3" />
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
            x={median(points.map((point) => point.salary_millions))}
            stroke="#8C8577"
            strokeDasharray="5 4"
          />
          <ReferenceLine
            y={median(points.map((point) => point.mvp_score))}
            stroke="#8C8577"
            strokeDasharray="5 4"
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
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
});
