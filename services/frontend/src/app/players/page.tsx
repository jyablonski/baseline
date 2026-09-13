"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { useDebounce } from "@/hooks/use-debounce";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import { formatNumber, formatStat } from "@/lib/format";
import { withSeason } from "@/lib/nav";
import type { PlayerSort } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

const SORT_OPTIONS: { value: PlayerSort; label: string }[] = [
  { value: "mvp", label: "MVP rank" },
  { value: "name", label: "Name" },
];

export default function PlayersPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading players…" />}>
      <PlayersDirectory />
    </Suspense>
  );
}

function PlayersDirectory() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { season, isLoading: seasonLoading } = useSeason();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [activeOnly, setActiveOnly] = useState(true);
  const [teamId, setTeamId] = useState("");
  const [sort, setSort] = useState<PlayerSort>("mvp");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const debounced = useDebounce(search, 300);

  const togglePlayer = useCallback((playerId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }, []);

  useEffect(() => {
    const next = debounced.trim();
    const current = searchParams.get("search") ?? "";
    if (next === current) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("search", next);
    else params.delete("search");
    router.replace(params.toString() ? `/players?${params}` : "/players");
  }, [debounced, router, searchParams]);

  const playersQuery = useQuery({
    queryKey: ["players", debounced, activeOnly, teamId, season, sort, page],
    queryFn: () =>
      api.searchPlayers(debounced.trim(), {
        active: activeOnly ? true : undefined,
        team_id: teamId || undefined,
        season: season || undefined,
        sort,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    // The MVP ladder follows the season, so wait for it instead of fetching twice.
    enabled: !seasonLoading,
  });
  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
  });

  const players = playersQuery.data?.data ?? [];
  const mvpSeason = players[0]?.mvp_season;
  const teamOptions = [...(teamsQuery.data?.data ?? [])].sort((a, b) =>
    a.abbreviation.localeCompare(b.abbreviation)
  );
  const total = playersQuery.data?.meta.total ?? 0;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-page">Players</h1>
        <p className="mt-1 text-sm text-ink-2">
          {formatNumber(total)} in directory. Select two or more players to compare them side by
          side.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          placeholder="Search players"
          className={cn("field w-48", search.trim() && "field-query")}
        />
        {search.trim() ? (
          <span className="border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            fuzzy
          </span>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={activeOnly}
            onCheckedChange={(checked) => {
              setActiveOnly(checked);
              setPage(0);
            }}
          />
          Active only
        </label>
        <select
          className={cn("field", teamId && "field-query")}
          value={teamId}
          onChange={(event) => {
            setTeamId(event.target.value);
            setPage(0);
          }}
        >
          <option value="">Team All</option>
          {teamOptions.map((team) => (
            <option key={team.team_id} value={team.team_id}>
              {team.abbreviation}
            </option>
          ))}
        </select>
        <div className="flex border border-border" role="group" aria-label="Sort players">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setSort(option.value);
                setPage(0);
              }}
              className={cn("seg-btn", sort === option.value && "seg-btn-active")}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {selected.size > 0 ? (
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
          ) : null}
          <button
            type="button"
            disabled={selected.size < 2}
            onClick={() =>
              router.push(withSeason(`/players/compare?ids=${[...selected].join(",")}`, season))
            }
            className="btn-fill"
          >
            Compare selected →
          </button>
        </div>
      </div>

      {playersQuery.isPending ? (
        <LoadingState label="Searching players…" />
      ) : playersQuery.isError ? (
        <ErrorState message={queryErrorMessage(playersQuery.error)} />
      ) : players.length === 0 ? (
        <EmptyState
          title={debounced ? "No players match" : "No players yet"}
          message={debounced ? "Try a different name." : "Nothing to show yet."}
        />
      ) : (
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-8" />
                  <th className="text-right">#</th>
                  <th>Name</th>
                  <th>Team</th>
                  <th>Pos</th>
                  <th className="text-right">MVP</th>
                  <th className="text-right">GP</th>
                  <th className="text-right">PPG</th>
                  <th className="text-right">RPG</th>
                  <th className="text-right">APG</th>
                  <th className="pl-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => (
                  <tr
                    key={player.player_id}
                    className={selected.has(player.player_id) ? "bg-row-selected" : undefined}
                  >
                    <td>
                      <Checkbox
                        checked={selected.has(player.player_id)}
                        onCheckedChange={() => togglePlayer(player.player_id)}
                      />
                    </td>
                    <td className="tabular text-right text-muted-foreground">
                      {player.mvp_rank ?? "—"}
                    </td>
                    <td>
                      <Link
                        href={`/players/${player.player_id}`}
                        className="text-primary hover:underline"
                      >
                        {player.full_name}
                      </Link>
                    </td>
                    <td className="font-semibold">{player.team_abbreviation ?? "—"}</td>
                    <td className="whitespace-nowrap">{player.position ?? "—"}</td>
                    <td className="tabular text-right">{formatStat(player.mvp_score)}</td>
                    <td className="tabular text-right">
                      {formatNumber(player.career_games_played)}
                    </td>
                    <td className="tabular text-right">{formatStat(player.career_ppg)}</td>
                    <td className="tabular text-right">{formatStat(player.career_rpg)}</td>
                    <td className="tabular text-right">{formatStat(player.career_apg)}</td>
                    <td className="pl-4 text-muted-foreground">
                      {player.is_active ? "Active" : "Inactive"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mvpSeason ? (
            <p className="type-caption">
              MVP is a custom metric based on {mvpSeason} regular-season performance: box-score
              production, scaled up in wins and down in losses, with a penalty for games missed. #
              is league rank.
            </p>
          ) : null}
        </div>
      )}

      {total > 0 ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            {from}–{to} of {formatNumber(total)} matches
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              className="btn-ghost"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={to >= total}
              onClick={() => setPage((current) => current + 1)}
              className="btn-ghost"
            >
              Next →
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
