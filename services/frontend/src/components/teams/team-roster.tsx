import Link from "next/link";

import { ColumnHelp } from "@/components/column-help";
import { EmptyState } from "@/components/query-state";
import { formatSignedMargin, formatStat } from "@/lib/format";
import { playerHref } from "@/lib/nav";
import { isOut } from "@/lib/team-page";
import type { PlayerInjury, RosterPlayer } from "@/lib/types";
import { cn } from "@/lib/utils";

type PerGameKey =
  | "minutes"
  | "points"
  | "rebounds"
  | "assists"
  | "steals"
  | "blocks"
  | "turnovers"
  | "three_pointers_made";

const PER_GAME: { key: PerGameKey; label: string; strong?: boolean }[] = [
  { key: "minutes", label: "MIN" },
  { key: "points", label: "PTS", strong: true },
  { key: "rebounds", label: "REB" },
  { key: "assists", label: "AST" },
  { key: "steals", label: "STL" },
  { key: "blocks", label: "BLK" },
  { key: "turnovers", label: "TOV" },
  { key: "three_pointers_made", label: "3PM" },
];

/** The current roster, per game for this team, with each player's injury status. */
export function TeamRoster({
  players,
  injuries,
  abbreviation,
}: {
  players: RosterPlayer[];
  injuries: PlayerInjury[];
  abbreviation: string;
}) {
  if (players.length === 0) {
    return <EmptyState message="No players on this roster yet." />;
  }
  const injuryByPlayer = new Map(injuries.map((injury) => [injury.player_id, injury]));
  const season = players.find((player) => player.season)?.season;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="data-table data-table-compact" data-testid="team-roster">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th className="text-right">GP</th>
              {PER_GAME.map((column) => (
                <th key={column.key} className="text-right">
                  {column.label}
                </th>
              ))}
              <ColumnHelp label="TS%" title="True shooting" className="text-right">
                <p>
                  Points per shooting possession, counting threes and free throws: PTS / (2 × (FGA +
                  0.44 × FTA)). League average sits near 58%.
                </p>
              </ColumnHelp>
              <ColumnHelp label="+/-" title="Plus-minus" className="text-right">
                <p>Average point margin while the player is on the court.</p>
              </ColumnHelp>
              <ColumnHelp label="GmSc" title="Game Score" align="end" className="text-right">
                <p>
                  A one-number box score: points and shooting efficiency, rebounds, assists, steals
                  and blocks, less turnovers and misses. 10 is an average night, 40 an outstanding
                  one. The MVP ladder is built on it.
                </p>
              </ColumnHelp>
              <ColumnHelp label="MVP" title="MVP score" align="end" className="text-right">
                <p>
                  Game Score weighted by wins and losses, less a penalty for games missed. The rank
                  is league-wide, counting every team the player has played for this season.
                </p>
              </ColumnHelp>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) => {
              const injury = injuryByPlayer.get(player.player_id);
              return (
                <tr key={player.player_id} data-testid="roster-row">
                  <td>
                    <Link
                      href={playerHref(player.full_name)}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {player.full_name}
                    </Link>
                  </td>
                  <td className="text-ink-2">{player.position ?? "—"}</td>
                  <td className="tabular text-right">{player.games_played}</td>
                  {PER_GAME.map((column) => (
                    <td
                      key={column.key}
                      className={cn("tabular text-right", column.strong && "font-semibold")}
                    >
                      {formatStat(player[column.key])}
                    </td>
                  ))}
                  <td className="tabular text-right">
                    {player.true_shooting_pct == null
                      ? "—"
                      : `${(player.true_shooting_pct * 100).toFixed(1)}%`}
                  </td>
                  <td className="tabular text-right">{formatSignedMargin(player.plus_minus, 1)}</td>
                  <td className="tabular text-right">{formatStat(player.game_score)}</td>
                  <td className="tabular whitespace-nowrap text-right">
                    {formatStat(player.mvp_score)}
                    {player.mvp_rank != null && (
                      <span className="text-ink-3"> · #{player.mvp_rank}</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap",
                      injury && isOut(injury) ? "text-destructive" : "text-ink-3"
                    )}
                  >
                    {injury
                      ? `${injury.injury_status}${injury.injury_detail ? ` · ${injury.injury_detail}` : ""}`
                      : "Active"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="type-caption">
        Per game with {abbreviation}
        {season ? `, ${season} Regular Season` : ""}. Most minutes first; a player yet to play for
        the team shows dashes.
      </p>
    </div>
  );
}
