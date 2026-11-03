import Link from "next/link";

import { KpiCard, KpiStrip } from "@/components/ui/kpi-card";
import { ErrorState, LoadingState } from "@/components/query-state";
import { queryErrorMessage } from "@/lib/api";
import {
  formatOrdinal,
  formatScheduleDate,
  formatShortDate,
  formatWeekdayDate,
} from "@/lib/format";
import { playerHref } from "@/lib/nav";
import {
  OVERVIEW_STATS,
  formatTeamStat,
  isOut,
  lastGames,
  rankFill,
  statRank,
} from "@/lib/team-page";
import type { PlayerInjury, TeamSeasonGame, TeamStatSplit } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TeamOverview({
  seasonStats,
  games,
  injuries,
  injuriesLoading,
  injuriesError,
  scheduleHref,
  rosterHref,
}: {
  seasonStats: TeamStatSplit | null;
  games: TeamSeasonGame[];
  injuries: PlayerInjury[] | undefined;
  injuriesLoading: boolean;
  injuriesError: unknown;
  scheduleHref: string;
  rosterHref: string;
}) {
  const recent = lastGames(games);
  // Every tile is possession-based, so a split still being backfilled says how
  // few games it rests on rather than passing two games off as a season.
  const coverage =
    seasonStats && seasonStats.games_with_possessions < seasonStats.games
      ? ` · ${seasonStats.games_with_possessions} of ${seasonStats.games} games`
      : "";
  return (
    <div className="space-y-10">
      <KpiStrip data-testid="team-ratings" className="-mt-6 border-t-0">
        {OVERVIEW_STATS.map((stat) => {
          const rank = seasonStats ? statRank(seasonStats, stat.key) : null;
          const count = seasonStats?.team_count ?? 0;
          return (
            <KpiCard
              key={stat.key}
              label={stat.label}
              value={formatTeamStat(seasonStats?.[stat.key], stat.format)}
              // Pace has no better direction, so it gets the rank but no meter.
              progress={rank != null && !stat.neutral ? rankFill(rank, count) : undefined}
              note={rank != null ? `${formatOrdinal(rank)} of ${count}${coverage}` : null}
            />
          );
        })}
      </KpiStrip>

      <section aria-labelledby="team-last-games">
        <SectionHeading id="team-last-games" title={`Last ${recent.length || 5}`}>
          <Link href={scheduleHref} scroll={false} className="text-sm text-primary hover:underline">
            Full schedule →
          </Link>
        </SectionHeading>
        {recent.length === 0 ? (
          <p className="py-3 text-sm text-ink-2">No games played yet this season.</p>
        ) : (
          <ol className="grid border-b border-rule sm:grid-cols-5">
            {recent.map((game) => (
              <li key={game.game_id} className="border-rule max-sm:border-t sm:[&+&]:border-l">
                <Link
                  href={`/games/${game.game_id}`}
                  data-testid="recent-game"
                  aria-label={`${formatScheduleDate(game.game_date)}, ${game.is_home ? "vs" : "at"} ${game.opponent_abbreviation ?? "opponent"}, ${game.result === "W" ? "won" : "lost"} ${game.team_score}–${game.opponent_score}`}
                  className="block px-4 py-3 hover:bg-tint"
                >
                  <span className="block text-xs text-ink-3">
                    {formatWeekdayDate(game.game_date)}
                  </span>
                  <span className="mt-1 block font-semibold">
                    {game.is_home ? "vs" : "@"} {game.opponent_abbreviation ?? "—"}
                  </span>
                  <span className="block text-sm tabular">
                    <span
                      className={cn(
                        "font-semibold",
                        game.result === "W" ? "text-primary" : "text-destructive"
                      )}
                    >
                      {game.result}
                    </span>{" "}
                    {game.team_score}–{game.opponent_score}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="team-injuries">
        <SectionHeading id="team-injuries" title="Injury report">
          <Link href={rosterHref} scroll={false} className="text-sm text-primary hover:underline">
            Roster →
          </Link>
        </SectionHeading>
        {injuriesLoading ? (
          <LoadingState label="Loading injuries…" />
        ) : injuriesError ? (
          <ErrorState message={queryErrorMessage(injuriesError)} />
        ) : !injuries || injuries.length === 0 ? (
          <p className="py-3 text-sm text-ink-2">Nobody on the injury report.</p>
        ) : (
          <ul>
            {injuries.map((injury) => (
              <li
                key={injury.player_id}
                data-testid="injury-row"
                className="grid gap-x-6 gap-y-1 border-b border-rule py-3 text-sm sm:grid-cols-[14rem_10rem_1fr]"
              >
                {injury.player_name ? (
                  <Link
                    href={playerHref(injury.player_name)}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {injury.player_name}
                  </Link>
                ) : (
                  <span>Unknown player</span>
                )}
                <span className={cn(isOut(injury) ? "text-destructive" : "text-ink-2")}>
                  {injury.injury_status}
                  {injury.injury_detail ? ` · ${injury.injury_detail}` : ""}
                </span>
                <span className="text-ink-2">
                  {injury.description}
                  {injury.update_date ? ` Updated ${formatShortDate(injury.update_date)}.` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionHeading({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule-strong pb-2">
      <h2 id={id} className="type-module">
        {title}
      </h2>
      {children}
    </div>
  );
}
