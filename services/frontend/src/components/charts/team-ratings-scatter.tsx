"use client";

import { useState } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  YAxis,
} from "recharts";

import { formatOrdinal, formatRecord, formatStat } from "@/lib/format";
import { teamHref } from "@/lib/nav";
import {
  leagueRatingAverages,
  netLines,
  netRating,
  paddedDomain,
  ratingRanks,
  teamRatingPoints,
  type RatingRanks,
  type TeamRatingPoint,
} from "@/lib/team-ratings";
import { teamLogoUrl } from "@/lib/team-logo";
import type { TeamSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const INK = "#1A1A1A";
const INK_2 = "#5C574F";
const INK_3 = "#8C8577";
const RULE = "#D8D3C6";
const PAPER = "#FBFAF5";
const GOOD = "#2D5A27";

const tickStyle = { fill: INK_2, fontSize: 12 };

export const QUADRANT_LABELS = {
  topLeft: "Defense carrying",
  topRight: "Good on both ends",
  bottomLeft: "Struggling on both ends",
  bottomRight: "Offense carrying",
} as const;

const MARKER_SIZE = 40;

/** A plotted team, with what the marker and the tooltip need beyond the two ratings. */
export type RatingDatum = TeamRatingPoint & {
  ranks?: RatingRanks;
  highlighted?: boolean;
  /** Another team is highlighted, so this one steps back. */
  dimmed?: boolean;
};

export function TeamLogoMarker({
  cx,
  cy,
  payload,
}: {
  cx?: number;
  cy?: number;
  payload?: RatingDatum;
}) {
  if (cx == null || cy == null || payload == null) return null;
  const logoUrl = teamLogoUrl(payload.abbreviation);
  return (
    <g opacity={payload.dimmed ? 0.35 : 1}>
      <a href={teamHref(payload.team_name)}>
        {payload.highlighted ? (
          <circle
            cx={cx}
            cy={cy}
            r={MARKER_SIZE / 2 + 5}
            fill={PAPER}
            stroke={INK}
            strokeWidth={2}
          />
        ) : null}
        {logoUrl ? (
          <image
            href={logoUrl}
            x={cx - MARKER_SIZE / 2}
            y={cy - MARKER_SIZE / 2}
            width={MARKER_SIZE}
            height={MARKER_SIZE}
            preserveAspectRatio="xMidYMid meet"
          />
        ) : (
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize={9} fontWeight={700} fill={INK_2}>
            {payload.abbreviation}
          </text>
        )}
      </a>
    </g>
  );
}

function formatNet(value: number) {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0.0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1)}`;
}

export function RatingsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: RatingDatum }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const net = netRating(point);
  const record =
    point.wins != null && point.losses != null ? formatRecord(point.wins, point.losses) : null;
  const row = (label: string, value: string, rank: number | undefined, tone?: string) => (
    <tr>
      <td className="py-0.5 pr-6 text-ink-2">{label}</td>
      <td className={cn("tabular py-0.5 text-right font-semibold", tone)}>{value}</td>
      <td className="tabular py-0.5 pl-4 text-right text-ink-2">{formatOrdinal(rank)}</td>
    </tr>
  );
  return (
    <div className="min-w-60 border border-ink bg-background px-4 py-3 text-sm shadow-sm">
      <p className="flex items-baseline justify-between gap-6">
        <span className="font-semibold">{point.team_name}</span>
        {record ? <span className="tabular text-ink-2">{record}</span> : null}
      </p>
      <table className="mt-2 w-full">
        <tbody>
          {row("Offense", formatStat(point.pts_scored_avg), point.ranks?.offense)}
          {row("Defense", formatStat(point.pts_allowed_avg), point.ranks?.defense)}
        </tbody>
        <tbody className="border-t border-rule">
          {row(
            "Net",
            formatNet(net),
            point.ranks?.net,
            net > 0 ? "text-primary" : net < 0 ? "text-destructive" : undefined
          )}
        </tbody>
      </table>
    </div>
  );
}

function renderTeamLogo(props: { cx?: number; cy?: number; payload?: RatingDatum }) {
  return <TeamLogoMarker cx={props.cx} cy={props.cy} payload={props.payload} />;
}

/** Quadrants, the league-average lines, and the dashed equal-net diagonals. */
function RatingGuides({
  avgScored,
  avgAllowed,
  xDomain,
  yDomain,
}: {
  avgScored: number;
  avgAllowed: number;
  xDomain: [number, number];
  yDomain: [number, number];
}) {
  const plot = usePlotArea();
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (plot == null || xScale == null || yScale == null) return null;

  const midX = xScale(avgScored);
  const midY = yScale(avgAllowed);
  if (midX == null || midY == null) return null;

  const { x, y, width, height } = plot;
  const pad = 12;
  const label = { fontSize: 13, fill: INK_2 };

  return (
    <g pointerEvents="none" aria-hidden="true">
      <rect
        x={midX}
        y={y}
        width={Math.max(x + width - midX, 0)}
        height={Math.max(midY - y, 0)}
        fill="rgba(45, 90, 39, 0.07)"
      />
      {netLines(xDomain, yDomain).map((line) => {
        const x1 = xScale(line.from.x);
        const y1 = yScale(line.from.y);
        const x2 = xScale(line.to.x);
        const y2 = yScale(line.to.y);
        if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
        // Three quarters along, clear of the corners where the quadrant names sit.
        const lx = x1 + (x2 - x1) * 0.75;
        const ly = y1 + (y2 - y1) * 0.75;
        const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        return (
          <g key={line.net}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#A8A194" strokeDasharray="5 4" />
            <text
              x={lx}
              y={ly}
              dy={-4}
              transform={`rotate(${angle} ${lx} ${ly})`}
              textAnchor="middle"
              fontSize={12}
              fill={line.net > 0 ? GOOD : INK_2}
              stroke={PAPER}
              strokeWidth={4}
              paintOrder="stroke"
            >
              {`Net ${line.net > 0 ? "+" : "−"}${Math.abs(line.net)}`}
            </text>
          </g>
        );
      })}
      <line x1={midX} y1={y} x2={midX} y2={y + height} stroke={INK_3} />
      <line x1={x} y1={midY} x2={x + width} y2={midY} stroke={INK_3} />
      <text x={x + width - 8} y={midY - 6} textAnchor="end" fontSize={12} fill={INK_2}>
        League avg {formatStat(avgAllowed)}
      </text>
      <text x={midX + 6} y={y + height - 8} textAnchor="start" fontSize={12} fill={INK_2}>
        League avg {formatStat(avgScored)}
      </text>
      <text x={x + pad} y={y + pad + 12} textAnchor="start" style={label}>
        {QUADRANT_LABELS.topLeft}
      </text>
      <text
        x={x + width - pad}
        y={y + pad + 12}
        textAnchor="end"
        style={{ ...label, fill: GOOD, fontWeight: 600 }}
      >
        {QUADRANT_LABELS.topRight}
      </text>
      <text x={x + pad} y={y + height - pad} textAnchor="start" style={label}>
        {QUADRANT_LABELS.bottomLeft}
      </text>
      <text x={x + width - pad} y={y + height - pad} textAnchor="end" style={label}>
        {QUADRANT_LABELS.bottomRight}
      </text>
    </g>
  );
}

/** Whole numbers outside the padded range, so the axis ends on a tick. */
function roundedDomain(values: number[]): [number, number] {
  const [min, max] = paddedDomain(values);
  return [Math.floor(min), Math.ceil(max)];
}

export function TeamRatingsScatter({ teams }: { teams: TeamSummary[] }) {
  const [highlight, setHighlight] = useState("");
  const points = teamRatingPoints(teams);
  const averages = leagueRatingAverages(points);
  if (points.length === 0 || averages == null) return null;

  const ranks = ratingRanks(points);
  const data: RatingDatum[] = points.map((point) => ({
    ...point,
    ranks: ranks.get(point.team_id),
    // The select hands back a string whatever type the id arrived as.
    highlighted: String(point.team_id) === highlight,
    dimmed: Boolean(highlight) && String(point.team_id) !== highlight,
  }));
  // Drawn last so the highlighted logo sits on top of any it overlaps.
  data.sort((left, right) => Number(left.highlighted) - Number(right.highlighted));
  const options = [...points].sort((left, right) => left.team_name.localeCompare(right.team_name));

  const xDomain = roundedDomain(points.map((point) => point.pts_scored_avg));
  const yDomain = roundedDomain(points.map((point) => point.pts_allowed_avg));

  return (
    <section className="w-full" aria-labelledby="team-ratings-heading">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-rule-strong pb-3">
        <div>
          <h2 id="team-ratings-heading" className="type-module">
            Offense vs defense
          </h2>
          <p className="mt-1 text-sm text-ink-2">Points scored and allowed per game</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-3">
          Highlight
          <select
            className={cn("field", highlight && "field-query")}
            value={highlight}
            onChange={(event) => setHighlight(event.target.value)}
          >
            <option value="">No team</option>
            {options.map((point) => (
              <option key={point.team_id} value={point.team_id}>
                {point.team_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-3 text-sm font-semibold text-primary">Better ↑</p>
      <div className="mx-auto mt-1 h-[360px] w-full sm:h-[520px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart width={640} height={480} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={RULE} strokeOpacity={0.6} />
            <XAxis
              type="number"
              dataKey="pts_scored_avg"
              name="Offense"
              domain={xDomain}
              tick={tickStyle}
              tickFormatter={(value: number) => String(Math.round(value))}
              tickLine={false}
              axisLine={{ stroke: RULE }}
              tickCount={6}
            />
            <YAxis
              type="number"
              dataKey="pts_allowed_avg"
              name="Defense"
              domain={yDomain}
              reversed
              tick={tickStyle}
              tickFormatter={(value: number) => String(Math.round(value))}
              tickLine={false}
              axisLine={{ stroke: RULE }}
              tickCount={6}
              width={44}
            />
            <RatingGuides
              avgScored={averages.pts_scored_avg}
              avgAllowed={averages.pts_allowed_avg}
              xDomain={xDomain}
              yDomain={yDomain}
            />
            <Tooltip
              content={<RatingsTooltip />}
              cursor={false}
              isAnimationActive={false}
              animationDuration={0}
            />
            <Scatter
              data={data}
              shape={renderTeamLogo}
              activeShape={renderTeamLogo}
              fill="none"
              stroke="none"
              legendType="none"
              isAnimationActive={false}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="text-right text-sm font-semibold text-primary">Better →</p>
      <p className="mt-2 text-right text-sm text-ink-2">
        Dashed lines: net rating. Hover or tap a team.
      </p>
    </section>
  );
}
