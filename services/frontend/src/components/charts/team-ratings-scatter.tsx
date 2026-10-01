"use client";

import {
  CartesianGrid,
  ReferenceLine,
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

import { formatStat } from "@/lib/format";
import { teamHref } from "@/lib/nav";
import {
  leagueRatingAverages,
  paddedDomain,
  teamRatingPoints,
  type TeamRatingPoint,
} from "@/lib/team-ratings";
import { teamLogoUrl } from "@/lib/team-logo";
import type { TeamSummary } from "@/lib/types";

const tooltipStyle = {
  background: "#FBFAF5",
  border: "1px solid #D8D3C6",
  borderRadius: 0,
  color: "#1A1A1A",
};

const tickStyle = { fill: "#5C574F", fontSize: 12 };
const axisLabelStyle = { fill: "#5C574F", fontSize: 12 };

const quadrantLabelStyle = {
  fill: "#8C8577",
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
};

export const QUADRANT_LABELS = {
  topLeft: "−offense / +defense",
  topRight: "+offense / +defense",
  bottomLeft: "−offense / −defense",
  bottomRight: "+offense / −defense",
} as const;

export function TeamLogoMarker({
  cx,
  cy,
  payload,
}: {
  cx?: number;
  cy?: number;
  payload?: TeamRatingPoint;
}) {
  if (cx == null || cy == null || payload == null) return null;
  const size = 51;
  const logoUrl = teamLogoUrl(payload.abbreviation);
  return (
    <g>
      <a href={teamHref(payload.team_name)}>
        {logoUrl ? (
          <image
            href={logoUrl}
            x={cx - size / 2}
            y={cy - size / 2}
            width={size}
            height={size}
            preserveAspectRatio="xMidYMid meet"
          />
        ) : (
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize={8} fontWeight={700} fill="#5C574F">
            {payload.abbreviation}
          </text>
        )}
      </a>
    </g>
  );
}

export function RatingsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: TeamRatingPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="recharts-default-tooltip" style={tooltipStyle}>
      <p className="recharts-tooltip-label" style={{ margin: 0 }}>
        {point.team_name}
      </p>
      <p className="recharts-tooltip-item" style={{ margin: 0, paddingTop: 4 }}>
        Scored {formatStat(point.pts_scored_avg)} · allowed {formatStat(point.pts_allowed_avg)}
      </p>
    </div>
  );
}

function renderTeamLogo(props: { cx?: number; cy?: number; payload?: TeamRatingPoint }) {
  return <TeamLogoMarker cx={props.cx} cy={props.cy} payload={props.payload} />;
}

function QuadrantGuides({ avgScored, avgAllowed }: { avgScored: number; avgAllowed: number }) {
  const plot = usePlotArea();
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (plot == null || xScale == null || yScale == null) return null;

  const midX = xScale(avgScored);
  const midY = yScale(avgAllowed);
  if (midX == null || midY == null) return null;

  const { x, y, width, height } = plot;
  const pad = 8;
  const goodTint = "rgba(45, 90, 39, 0.035)";
  const mixedTint = "rgba(216, 211, 198, 0.18)";
  const weakTint = "rgba(140, 133, 119, 0.06)";

  return (
    <g pointerEvents="none" aria-hidden="true">
      <rect
        x={x}
        y={y}
        width={Math.max(midX - x, 0)}
        height={Math.max(midY - y, 0)}
        fill={mixedTint}
      />
      <rect
        x={midX}
        y={y}
        width={Math.max(x + width - midX, 0)}
        height={Math.max(midY - y, 0)}
        fill={goodTint}
      />
      <rect
        x={x}
        y={midY}
        width={Math.max(midX - x, 0)}
        height={Math.max(y + height - midY, 0)}
        fill={weakTint}
      />
      <rect
        x={midX}
        y={midY}
        width={Math.max(x + width - midX, 0)}
        height={Math.max(y + height - midY, 0)}
        fill={mixedTint}
      />
      <text x={x + pad} y={y + pad + 9} textAnchor="start" style={quadrantLabelStyle}>
        {QUADRANT_LABELS.topLeft}
      </text>
      <text x={x + width - pad} y={y + pad + 9} textAnchor="end" style={quadrantLabelStyle}>
        {QUADRANT_LABELS.topRight}
      </text>
      <text x={x + pad} y={y + height - pad} textAnchor="start" style={quadrantLabelStyle}>
        {QUADRANT_LABELS.bottomLeft}
      </text>
      <text x={x + width - pad} y={y + height - pad} textAnchor="end" style={quadrantLabelStyle}>
        {QUADRANT_LABELS.bottomRight}
      </text>
    </g>
  );
}

export function TeamRatingsScatter({ teams }: { teams: TeamSummary[] }) {
  const points = teamRatingPoints(teams);
  const averages = leagueRatingAverages(points);
  if (points.length === 0 || averages == null) return null;

  const xDomain = paddedDomain(points.map((point) => point.pts_scored_avg));
  const yDomain = paddedDomain(points.map((point) => point.pts_allowed_avg));

  return (
    <section className="w-full" aria-labelledby="team-ratings-heading">
      <h2 id="team-ratings-heading" className="type-eyebrow">
        Team offensive vs defensive rating
      </h2>
      <div className="mx-auto mt-4 h-[320px] w-full sm:h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart
            width={640}
            height={400}
            margin={{ top: 16, right: 20, bottom: 12, left: 8 }}
          >
            <CartesianGrid stroke="#D8D3C6" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="pts_scored_avg"
              name="Offensive rating"
              domain={xDomain}
              tick={tickStyle}
              tickFormatter={(value: number) => String(Math.round(value))}
              tickLine={false}
              axisLine={false}
              tickCount={5}
              label={{
                value: "Offensive rating",
                position: "insideBottom",
                offset: -4,
                style: axisLabelStyle,
              }}
            />
            <YAxis
              type="number"
              dataKey="pts_allowed_avg"
              name="Defensive rating"
              domain={yDomain}
              reversed
              tick={tickStyle}
              tickFormatter={(value: number) => String(Math.round(value))}
              tickLine={false}
              axisLine={false}
              tickCount={5}
              width={56}
              label={{
                value: "Defensive rating",
                angle: -90,
                position: "insideLeft",
                style: axisLabelStyle,
              }}
            />
            <QuadrantGuides
              avgScored={averages.pts_scored_avg}
              avgAllowed={averages.pts_allowed_avg}
            />
            <ReferenceLine x={averages.pts_scored_avg} stroke="#8C8577" strokeDasharray="5 4" />
            <ReferenceLine y={averages.pts_allowed_avg} stroke="#8C8577" strokeDasharray="5 4" />
            <Tooltip
              content={<RatingsTooltip />}
              cursor={{ stroke: "#D8D3C6", strokeDasharray: "4 4" }}
              isAnimationActive={false}
              animationDuration={0}
            />
            <Scatter
              data={points}
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
    </section>
  );
}
