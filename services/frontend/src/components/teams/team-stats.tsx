"use client";

import { useState } from "react";

import { EmptyState } from "@/components/query-state";
import { formatOrdinal } from "@/lib/format";
import {
  STAT_GROUPS,
  STAT_SPLITS,
  formatTeamStat,
  rankFill,
  rankTone,
  statRank,
  type RankTone,
} from "@/lib/team-page";
import type { TeamStatSplit, TeamStatSplitName } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONE_BAR: Record<RankTone, string> = {
  good: "bg-primary",
  middle: "bg-ink-3",
  bad: "bg-destructive/60",
  neutral: "bg-ink-3",
};

/** Every team stat for one split, each against the league with a rank bar. */
export function TeamStats({ splits }: { splits: TeamStatSplit[] }) {
  const [splitName, setSplitName] = useState<TeamStatSplitName>("season");
  const split = splits.find((row) => row.split === splitName) ?? null;
  const count = split?.team_count ?? splits[0]?.team_count ?? 30;

  if (splits.length === 0) {
    return <EmptyState message="No Regular Season games played yet." />;
  }

  return (
    <div className="space-y-8" data-testid="team-stats">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex border border-input" role="group" aria-label="Split">
          {STAT_SPLITS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={option.value === splitName}
              onClick={() => setSplitName(option.value)}
              className={cn("seg-btn normal-case", option.value === splitName && "seg-btn-active")}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-ink-3">
          Rank among {count} teams · bar fills toward 1st
          {split ? ` · ${split.games} game${split.games === 1 ? "" : "s"}` : ""}
        </p>
      </div>

      {!split ? (
        <EmptyState message="No games in this split yet." />
      ) : (
        STAT_GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h2 className="type-module border-b border-rule-strong pb-2">{group.title}</h2>
            <table className="w-full text-sm">
              <tbody>
                {group.stats.map((stat) => {
                  const rank = statRank(split, stat.key);
                  const tone = rankTone(rank, split.team_count, stat.neutral);
                  return (
                    <tr key={stat.key} className="border-b border-rule" data-testid="team-stat-row">
                      <th scope="row" className="py-3 text-left font-normal">
                        {stat.label}
                      </th>
                      <td className="w-24 py-3 text-right font-semibold tabular">
                        {formatTeamStat(split[stat.key], stat.format)}
                      </td>
                      <td className="hidden w-52 py-3 pl-5 sm:table-cell">
                        <div
                          role="progressbar"
                          aria-label={`${stat.label} rank`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(rankFill(rank, split.team_count) * 100)}
                          className="h-[5px] bg-rule"
                        >
                          <div
                            className={cn("h-full", TONE_BAR[tone])}
                            style={{ width: `${rankFill(rank, split.team_count) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="w-16 py-3 text-right text-ink-2 tabular">
                        {formatOrdinal(rank)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))
      )}
      {split && split.games_with_possessions < split.games ? (
        <p className="type-caption">
          Ratings, pace, rebound and turnover rates cover {split.games_with_possessions} of{" "}
          {split.games} games; the rest have no offensive rebound count in their box score yet.
        </p>
      ) : (
        <p className="type-caption">
          Regular Season only. Possessions are estimated from the box score (FGA − OREB + TOV + 0.44
          × FTA, averaged across both teams). Pace has no better direction, so its bar is grey.
        </p>
      )}
    </div>
  );
}
