import { Sparkline } from "@/components/charts/sparkline";
import { KpiStrip } from "@/components/ui/kpi-card";
import { formatShortDate } from "@/lib/format";
import {
  TREND_DIRECTION_LABEL,
  changeTone,
  changedCount,
  formatTrendChange,
  formatTrendValue,
  headlineStats,
  trendStat,
  trendStatLabel,
  trendStatName,
} from "@/lib/player-trends";
import type { PlayerTrend, PlayerTrendStat } from "@/lib/types";
import { cn } from "@/lib/utils";

export const TONE_CLASS = {
  better: "text-primary",
  worse: "text-destructive",
  neutral: "text-ink-2",
} as const;

export function TrendDirection({
  direction,
  className,
}: {
  direction: PlayerTrend["trend_direction"];
  className?: string;
}) {
  const arrow = direction === "up" ? "▲ " : direction === "down" ? "▼ " : "";
  return (
    <span
      className={cn(
        "text-sm font-semibold",
        direction === "up" && "text-primary",
        direction === "down" && "text-destructive",
        direction === "steady" && "text-ink-2",
        className
      )}
    >
      {arrow}
      {TREND_DIRECTION_LABEL[direction]}
    </span>
  );
}

/** "▲ +6.6" when the change beats the usual swings, "steady" otherwise. */
export function TrendChange({ stat, className }: { stat: PlayerTrendStat; className?: string }) {
  const tone = changeTone(stat);
  // Minutes are never judged, but a real move still gets its number.
  const moved = stat.changed && stat.change != null && stat.change !== 0;
  if (!moved) {
    return <span className={cn("text-sm font-semibold text-ink-3", className)}>steady</span>;
  }
  return (
    <span
      data-tone={tone}
      className={cn("tabular text-sm font-semibold", TONE_CLASS[tone], className)}
    >
      {/* The arrow is the direction of the number; the colour says whether that is good. */}
      {(stat.change ?? 0) > 0 ? "▲ " : "▼ "}
      {formatTrendChange(stat.stat, stat.change)}
    </span>
  );
}

/** A player's last 10 against their earlier games. The page renders it only once a trend exists. */
export function PlayerForm({ trend }: { trend: PlayerTrend }) {
  const points = trendStat(trend, "points");
  const tiles = headlineStats(trend);
  const changed = changedCount(trend);
  const earlier = `${trend.baseline_games} ${trend.baseline_games === 1 ? "game" : "games"}`;
  return (
    <section aria-labelledby="player-form" data-testid="player-trend">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="player-form" className="type-module">
          Form
        </h2>
        <TrendDirection direction={trend.trend_direction} />
      </div>
      {points ? (
        <p className="mt-2">
          Last {trend.window_games} games: {formatTrendValue("points", points.last_10)} points a
          game, against {formatTrendValue("points", points.baseline)} in the {earlier} before.
        </p>
      ) : null}
      <p className="type-caption mt-1">
        {formatShortDate(trend.window_start_date)} – {formatShortDate(trend.window_end_date)}
      </p>

      <KpiStrip className="mt-4">
        {tiles.map((stat) => (
          <div key={stat.stat} className="border-rule p-4" data-testid="trend-tile">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              {trendStatName(stat.stat)}
            </p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="type-stat tabular">{formatTrendValue(stat.stat, stat.last_10)}</span>
              <TrendChange stat={stat} />
            </p>
            <p className="type-caption mt-1">
              prior {trend.baseline_games}: {formatTrendValue(stat.stat, stat.baseline)}
            </p>
            <Sparkline
              className="mt-3"
              width={160}
              values={stat.games}
              reference={stat.baseline}
              tone={changeTone(stat)}
            />
          </div>
        ))}
      </KpiStrip>
      <div className="type-caption mt-2 flex flex-wrap justify-between gap-2">
        <p>Line: each game, oldest to newest. Dashed: the average of the {earlier} before.</p>
        <p>
          Arrows only when the change is bigger than this player&apos;s usual game-to-game swings.
        </p>
      </div>

      <details className="mt-3 border-y border-rule">
        <summary className="flex cursor-pointer items-baseline gap-3 py-3">
          <span className="font-semibold">All stats</span>
          <span className="text-sm text-ink-2">
            {changed} of {trend.stats.length} changed
          </span>
        </summary>
        <div className="overflow-x-auto pb-3">
          <table className="data-table data-table-compact">
            <thead>
              <tr>
                <th>Stat</th>
                <th className="text-right">Last {trend.window_games}</th>
                <th className="text-right">Earlier</th>
                <th className="text-right">Change</th>
                <th className="text-right">Season</th>
              </tr>
            </thead>
            <tbody>
              {trend.stats.map((stat) => (
                <tr key={stat.stat}>
                  <td>{trendStatLabel(stat.stat)}</td>
                  <td className="tabular text-right font-semibold">
                    {formatTrendValue(stat.stat, stat.last_10)}
                  </td>
                  <td className="tabular text-right">
                    {formatTrendValue(stat.stat, stat.baseline)}
                  </td>
                  <td className="text-right">
                    <TrendChange stat={stat} />
                  </td>
                  <td className="tabular text-right text-ink-2">
                    {formatTrendValue(stat.stat, stat.season)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
