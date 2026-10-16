"use client";

import { useMemo, useState } from "react";

import { formatNumber, formatSignedMargin, formatWinPct } from "@/lib/format";
import type { BoxScoreRow } from "@/lib/types";
import { cn } from "@/lib/utils";

type SortDirection = "asc" | "desc";

type Column = {
  key: string;
  label: string;
  /** Percentage columns show only with Shooting % on. */
  shooting?: boolean;
  className?: (row: BoxScoreRow) => string | false;
  /** Null sorts last in both directions, so blanks never lead the table. */
  value: (row: BoxScoreRow) => number | string | null;
  numeric: boolean;
  render: (row: BoxScoreRow) => string;
};

/** "10-21", or a dash when the player never attempted one. */
function attempts(made: number | null, attempted: number | null) {
  if (made == null || attempted == null) return "—";
  return `${made}-${attempted}`;
}

const COLUMNS: Column[] = [
  {
    key: "player",
    label: "Player",
    value: (row) => row.player_name,
    numeric: false,
    render: (row) => row.player_name ?? "—",
  },
  {
    key: "minutes",
    label: "MIN",
    value: (row) => row.minutes,
    numeric: true,
    render: (row) => formatNumber(row.minutes, 1),
  },
  {
    key: "points",
    label: "PTS",
    value: (row) => row.points,
    numeric: true,
    render: (row) => formatNumber(row.points),
  },
  {
    key: "rebounds",
    label: "REB",
    value: (row) => row.rebounds,
    numeric: true,
    render: (row) => formatNumber(row.rebounds),
  },
  {
    key: "assists",
    label: "AST",
    value: (row) => row.assists,
    numeric: true,
    render: (row) => formatNumber(row.assists),
  },
  {
    key: "fg",
    label: "FG",
    value: (row) => row.field_goals_made,
    numeric: true,
    render: (row) => attempts(row.field_goals_made, row.field_goals_attempted),
  },
  {
    key: "fg_pct",
    shooting: true,
    label: "FG%",
    value: (row) => row.field_goal_pct,
    numeric: true,
    render: (row) => formatWinPct(row.field_goal_pct),
  },
  {
    key: "three",
    label: "3P",
    value: (row) => row.three_pointers_made,
    numeric: true,
    render: (row) => attempts(row.three_pointers_made, row.three_pointers_attempted),
  },
  {
    key: "three_pct",
    shooting: true,
    label: "3P%",
    value: (row) => row.three_point_pct,
    numeric: true,
    render: (row) => formatWinPct(row.three_point_pct),
  },
  {
    key: "ft",
    label: "FT",
    value: (row) => row.free_throws_made,
    numeric: true,
    render: (row) => attempts(row.free_throws_made, row.free_throws_attempted),
  },
  {
    key: "ft_pct",
    shooting: true,
    label: "FT%",
    value: (row) => row.free_throw_pct,
    numeric: true,
    render: (row) => formatWinPct(row.free_throw_pct),
  },
  {
    key: "ts_pct",
    shooting: true,
    label: "TS%",
    value: (row) => row.true_shooting_pct,
    numeric: true,
    render: (row) => formatWinPct(row.true_shooting_pct),
  },
  {
    key: "plus_minus",
    label: "+/−",
    value: (row) => row.plus_minus,
    numeric: true,
    render: (row) => formatSignedMargin(row.plus_minus),
    className: (row) =>
      row.plus_minus != null &&
      row.plus_minus !== 0 &&
      (row.plus_minus > 0 ? "text-primary" : "text-destructive"),
  },
  {
    key: "mvp",
    label: "MVP",
    value: (row) => row.mvp_game_score ?? null,
    numeric: true,
    render: (row) => formatNumber(row.mvp_game_score, 1),
  },
];

const DEFAULT_SORT = "points";

export type BoxScoreSide = { teamId: string; label: string };

/**
 * One team's lines at a time. `sides` names the switch ("Knicks 94") in the
 * order to show it; without it the teams come in the API's order, home first.
 */
export function BoxScore({
  rows,
  sides,
  defaultTeamId,
}: {
  rows: BoxScoreRow[];
  sides?: BoxScoreSide[];
  defaultTeamId?: string | null;
}) {
  const teams: { key: string; label: string; rows: BoxScoreRow[] }[] = [];
  for (const row of rows) {
    const existing = teams.find((team) => team.key === row.team_id);
    if (existing) existing.rows.push(row);
    else
      teams.push({
        key: row.team_id,
        label: row.team_name ?? row.team_abbreviation ?? "Team",
        rows: [row],
      });
  }
  if (sides) {
    const order = sides.map((side) => side.teamId);
    teams.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    for (const team of teams) {
      team.label = sides.find((side) => side.teamId === team.key)?.label ?? team.label;
    }
  }
  const [teamKey, setTeamKey] = useState<string | null>(defaultTeamId ?? null);
  const [shooting, setShooting] = useState(false);
  const shown = teams.find((team) => team.key === teamKey) ?? teams[0];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-strong pb-2">
        <h2 className="type-module">Box score</h2>
        <div className="flex flex-wrap gap-2">
          {teams.length > 1 ? (
            <div className="flex border border-input" role="group" aria-label="Team">
              {teams.map((team) => (
                <button
                  key={team.key}
                  type="button"
                  aria-pressed={team.key === shown?.key}
                  onClick={() => setTeamKey(team.key)}
                  className={cn("seg-btn normal-case", team.key === shown?.key && "seg-btn-active")}
                >
                  {team.label}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            aria-pressed={shooting}
            onClick={() => setShooting((current) => !current)}
            className={cn("seg-btn border border-input normal-case", shooting && "seg-btn-active")}
          >
            Shooting %
          </button>
        </div>
      </div>
      {shown ? (
        <TeamTable
          key={shown.key}
          rows={shown.rows}
          columns={COLUMNS.filter((column) => shooting || !column.shooting)}
        />
      ) : null}
    </section>
  );
}

/** The team line: summed counts and shooting from the summed attempts. */
function teamTotals(rows: BoxScoreRow[]): BoxScoreRow {
  const sum = (pick: (row: BoxScoreRow) => number | null | undefined) =>
    rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
  const ratio = (made: number, attempted: number) => (attempted > 0 ? made / attempted : null);
  const fgm = sum((row) => row.field_goals_made);
  const fga = sum((row) => row.field_goals_attempted);
  const tpm = sum((row) => row.three_pointers_made);
  const tpa = sum((row) => row.three_pointers_attempted);
  const ftm = sum((row) => row.free_throws_made);
  const fta = sum((row) => row.free_throws_attempted);
  const points = sum((row) => row.points);
  const tsa = 2 * (fga + 0.44 * fta);
  return {
    ...rows[0],
    player_id: "team",
    player_name: "Team",
    minutes: Math.round(sum((row) => row.minutes)),
    points,
    rebounds: sum((row) => row.rebounds),
    assists: sum((row) => row.assists),
    field_goals_made: fgm,
    field_goals_attempted: fga,
    field_goal_pct: ratio(fgm, fga),
    three_pointers_made: tpm,
    three_pointers_attempted: tpa,
    three_point_pct: ratio(tpm, tpa),
    free_throws_made: ftm,
    free_throws_attempted: fta,
    free_throw_pct: ratio(ftm, fta),
    true_shooting_pct: tsa > 0 ? points / tsa : null,
    plus_minus: null,
    mvp_game_score: null,
  };
}

function TeamTable({ rows, columns }: { rows: BoxScoreRow[]; columns: Column[] }) {
  const [chosenKey, setSortKey] = useState(DEFAULT_SORT);
  const [chosenDirection, setDirection] = useState<SortDirection>("desc");
  const totals = useMemo(() => teamTotals(rows), [rows]);
  // A sort on a column Shooting % has since hidden falls back to points, so the
  // order on screen always has a visible arrow explaining it.
  const visible = columns.some((column) => column.key === chosenKey);
  const sortKey = visible ? chosenKey : DEFAULT_SORT;
  const direction = visible ? chosenDirection : "desc";

  const sorted = useMemo(() => {
    const column = COLUMNS.find((item) => item.key === sortKey) ?? COLUMNS[0];
    const factor = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = column.value(a);
      const right = column.value(b);
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      if (typeof left === "string" || typeof right === "string") {
        return String(left).localeCompare(String(right)) * factor;
      }
      return (left - right) * factor;
    });
  }, [rows, sortKey, direction]);

  function toggle(column: Column) {
    if (column.key === sortKey) {
      // From what is on screen, which after a fallback is not what was chosen.
      setSortKey(column.key);
      setDirection(direction === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(column.key);
    // A name reads alphabetically; every stat is more useful biggest-first.
    setDirection(column.numeric ? "desc" : "asc");
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => {
                const active = column.key === sortKey;
                return (
                  <th
                    key={column.key}
                    className={cn(column.numeric && "text-right", active && "is-sorted")}
                    aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(column)}
                      className="inline-flex items-center gap-1 uppercase"
                    >
                      {column.label}
                      <span aria-hidden className={cn("text-ink-3", !active && "invisible")}>
                        {direction === "asc" ? "▲" : "▼"}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.player_id}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      column.numeric && "tabular text-right",
                      column.key === "player" && "font-medium",
                      column.className?.(row)
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr
              className="border-t border-rule-strong font-semibold"
              data-testid="box-score-totals"
            >
              {columns.map((column) => (
                <td key={column.key} className={cn(column.numeric && "tabular text-right")}>
                  {column.key === "plus_minus" || column.key === "mvp" ? "" : column.render(totals)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
