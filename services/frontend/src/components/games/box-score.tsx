"use client";

import { useMemo, useState } from "react";

import { formatNumber, formatSignedMargin, formatWinPct } from "@/lib/format";
import type { BoxScoreRow } from "@/lib/types";
import { cn } from "@/lib/utils";

type SortDirection = "asc" | "desc";

type Column = {
  key: string;
  label: string;
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
    label: "FT%",
    value: (row) => row.free_throw_pct,
    numeric: true,
    render: (row) => formatWinPct(row.free_throw_pct),
  },
  {
    key: "ts_pct",
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

export function BoxScore({ rows }: { rows: BoxScoreRow[] }) {
  // The API orders home team first, so grouping by first appearance keeps that
  // without re-sorting. Each team sorts on its own.
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

  return (
    <section className="space-y-6">
      <h2 className="type-module">Box score</h2>
      {teams.map((team) => (
        <TeamTable key={team.key} label={team.label} rows={team.rows} />
      ))}
    </section>
  );
}

function TeamTable({ label, rows }: { label: string; rows: BoxScoreRow[] }) {
  const [sortKey, setSortKey] = useState(DEFAULT_SORT);
  const [direction, setDirection] = useState<SortDirection>("desc");

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
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(column.key);
    // A name reads alphabetically; every stat is more useful biggest-first.
    setDirection(column.numeric ? "desc" : "asc");
  }

  return (
    <div>
      <h3 className="type-eyebrow mb-2">{label}</h3>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => {
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
                {COLUMNS.map((column) => (
                  <td key={column.key} className={cn(column.numeric && "tabular text-right")}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
