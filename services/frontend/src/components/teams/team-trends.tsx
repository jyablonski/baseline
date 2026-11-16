import Link from "next/link";

import { Sparkline } from "@/components/charts/sparkline";
import { TONE_CLASS, TrendDirection } from "@/components/players/player-trend";
import { playerHref } from "@/lib/nav";
import {
  biggestMover,
  changeTone,
  formatTrendChange,
  formatTrendValue,
  mvpTrendStat,
  risersAndFallers,
  trendStatName,
} from "@/lib/player-trends";
import type { PlayerTrend } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Risers and fallers on the roster; renders nothing while every qualified player is steady, or none qualify. */
export function TeamTrends({
  trends,
  heading,
}: {
  trends: PlayerTrend[];
  heading: React.ReactNode;
}) {
  const { risers, fallers } = risersAndFallers(trends);
  if (risers.length === 0 && fallers.length === 0) return null;
  return (
    <section aria-labelledby="team-trends" data-testid="team-trends">
      {heading}
      <div className="grid gap-x-10 sm:grid-cols-2">
        {risers.length > 0 ? <TrendList direction="up" trends={risers} /> : null}
        {fallers.length > 0 ? <TrendList direction="down" trends={fallers} /> : null}
      </div>
      <p className="type-caption mt-3">
        Up and down follow each player&apos;s MVP game score. Each row shows the one stat that moved
        most past its usual game-to-game swings.
      </p>
    </section>
  );
}

function TrendList({ direction, trends }: { direction: "up" | "down"; trends: PlayerTrend[] }) {
  return (
    <div className="pt-3">
      <TrendDirection direction={direction} />
      <ol className="mt-1">
        {trends.map((trend) => {
          // The MVP number itself when no single box stat stands out.
          const stat = biggestMover(trend) ?? mvpTrendStat(trend);
          const tone = stat ? changeTone(stat) : "neutral";
          return (
            <li
              key={trend.player_id}
              className="grid grid-cols-[minmax(0,1fr)_auto_4rem] items-center gap-4 border-b border-rule py-2"
              data-testid={`trend-${direction}`}
            >
              <div className="min-w-0">
                <Link href={playerHref(trend.full_name)} className="font-semibold hover:underline">
                  {trend.full_name}
                </Link>
                {stat ? (
                  <span className="block text-sm text-ink-2">
                    {trendStatName(stat.stat)}{" "}
                    <span className="font-semibold text-foreground">
                      {formatTrendValue(stat.stat, stat.last_10)}
                    </span>{" "}
                    · was {formatTrendValue(stat.stat, stat.baseline)}
                  </span>
                ) : null}
              </div>
              {stat ? (
                <Sparkline
                  values={stat.games}
                  reference={stat.baseline}
                  tone={tone}
                  width={110}
                  height={28}
                />
              ) : (
                <span />
              )}
              <span
                className={cn("tabular text-right font-semibold", TONE_CLASS[tone])}
                data-tone={tone}
              >
                {stat ? formatTrendChange(stat.stat, stat.change) : "—"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
