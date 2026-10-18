"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamLogo } from "@/components/team-logo";
import { api, queryErrorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  NOTABLE_TAB_INFO,
  NOTABLE_TABS,
  closestRow,
  comebackRow,
  marginRow,
  notableTab,
  rowLine,
  upsetRow,
  type NotableRow,
  type NotableTab,
} from "@/lib/notables";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

/**
 * One season's comebacks, upsets, closest games and largest margins, a tab at
 * a time. Tab and team live in the URL so a list can be shared. There is no
 * season picker: the caller passes the newest season with finished games,
 * since only it has data here (no odds backfill, and play-by-play is only
 * scraped for the current season).
 */
export function SeasonNotables({ season }: { season: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = notableTab(searchParams.get("tab"));
  const team = searchParams.get("team")?.toUpperCase() ?? "";

  // Same query key as the other directories, so this shares their cached list.
  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
  });
  // One pass over the teams list: abbreviations for the filter, and their ids
  // for the logos (the flow marts carry abbreviations only).
  const { teamIds, teamOptions } = useMemo(() => {
    const teams = (teamsQuery.data?.data ?? []).filter(
      (item): item is typeof item & { abbreviation: string } => Boolean(item.abbreviation)
    );
    return {
      teamIds: new Map(teams.map((item) => [item.abbreviation, item.team_id])),
      teamOptions: teams
        .map((item) => item.abbreviation)
        .sort((left, right) => left.localeCompare(right)),
    };
  }, [teamsQuery.data]);

  function hrefWith(changes: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    return `${pathname}?${params.toString()}`;
  }

  const info = NOTABLE_TAB_INFO[tab];

  return (
    <section aria-label="Season notables" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="type-module">Season notables</h2>
        <label className="flex items-center gap-1.5 text-xs text-ink-2">
          Team
          <select
            className={cn("field px-1.5", team && "field-query")}
            value={team}
            onChange={(event) =>
              router.replace(hrefWith({ team: event.target.value }), { scroll: false })
            }
          >
            <option value="">All teams</option>
            {teamOptions.map((abbreviation) => (
              <option key={abbreviation} value={abbreviation}>
                {abbreviation}
              </option>
            ))}
          </select>
        </label>
      </div>
      <nav
        aria-label="Notable games"
        // Scrolls sideways on phones; the scrollbar itself is hidden so it does
        // not draw a stray bar at the end of the tabs.
        className="flex overflow-x-auto border-b border-rule-strong whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {NOTABLE_TABS.map((item) => (
          <Link
            key={item}
            href={hrefWith({ tab: item === "comebacks" ? "" : item })}
            replace
            scroll={false}
            aria-current={item === tab ? "page" : undefined}
            className={cn(
              "-mb-px border-b-[3px] border-transparent px-3 py-2.5 text-ink-2 hover:text-foreground",
              item === tab && "border-primary font-semibold text-foreground"
            )}
          >
            {NOTABLE_TAB_INFO[item].label}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-ink-2">{info.description}</p>
      <NotableList tab={tab} team={team} season={season} teamIds={teamIds} />
    </section>
  );
}

async function fetchRows(
  tab: NotableTab,
  params: { season?: string; team?: string; limit: number; offset: number }
): Promise<NotableRow[]> {
  if (tab === "upsets") {
    const page = await api.listUpsets(params);
    return page.data.map((upset) => upsetRow(upset, params.team));
  }
  if (tab === "margins") {
    const page = await api.listLargestMargins(params);
    return page.data.map((game) => marginRow(game, params.team));
  }
  if (tab === "closest") {
    const page = await api.listClosestGames(params);
    return page.data.map((game) => closestRow(game, params.team));
  }
  const page = await api.listBiggestCollapses(params);
  return page.data.map((collapse) => comebackRow(collapse, params.team));
}

function NotableList({
  tab,
  team,
  season,
  teamIds,
}: {
  tab: NotableTab;
  team: string;
  season: string;
  /** Abbreviation to team id: the flow marts carry abbreviations only, and a logo needs an id. */
  teamIds: Map<string, string>;
}) {
  const info = NOTABLE_TAB_INFO[tab];
  // Back to the first page whenever the tab, team or season changes. Held as
  // the filter it belongs to rather than reset in an effect, so a new filter
  // never fetches its page 2 first.
  const filterKey = `${tab}|${team}|${season}`;
  const [paging, setPaging] = useState({ filterKey, page: 0 });
  const page = paging.filterKey === filterKey ? paging.page : 0;
  const query = useQuery({
    queryKey: ["notables", tab, season, team, page],
    // One row past the page: these routes report the page's own length as the
    // total, so the extra row is the only sign there is a next page.
    queryFn: () =>
      fetchRows(tab, {
        season: season || undefined,
        team: team || undefined,
        limit: PAGE_SIZE + 1,
        offset: page * PAGE_SIZE,
      }),
    // Keep the previous rows mounted while the next page or filter loads, so
    // the page height does not collapse and throw the reader back up the page.
    placeholderData: keepPreviousData,
  });
  const fetched = query.data ?? [];
  const rows = fetched.slice(0, PAGE_SIZE);
  const hasNext = fetched.length > PAGE_SIZE;
  const shownPage = query.isPlaceholderData ? paging.page : page;

  function goTo(next: number) {
    setPaging({ filterKey, page: next });
  }

  if (query.isPending) return <LoadingState label="Loading notable games…" />;
  if (query.isError) return <ErrorState message={queryErrorMessage(query.error)} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        message={team ? `No ${info.label.toLowerCase()} involving ${team} yet.` : info.empty}
      />
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table
          className={cn("data-table", query.isPlaceholderData && "opacity-60")}
          aria-busy={query.isFetching}
          data-testid="notables-table"
        >
          <thead>
            <tr>
              <th className="hidden w-8 sm:table-cell">#</th>
              <th className="hidden w-32 sm:table-cell">Date</th>
              <th>Game</th>
              <th className="w-20 text-right sm:w-36">{info.headline}</th>
              <th className="w-20 text-right sm:w-32">{info.secondary}</th>
              <th className="w-8" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <NotableTableRow
                key={row.gameId}
                row={row}
                rank={shownPage * PAGE_SIZE + index + 1}
                teamIds={teamIds}
              />
            ))}
          </tbody>
        </table>
      </div>
      {page > 0 || hasNext ? (
        <nav
          aria-label="Notable games pages"
          className="mt-3 flex items-center justify-between text-sm"
        >
          <button
            type="button"
            className="btn-ghost"
            disabled={page === 0 || query.isPlaceholderData}
            onClick={() => goTo(page - 1)}
          >
            ← Prev
          </button>
          <span className="text-ink-2 tabular" aria-live="polite">
            Page {page + 1}
          </span>
          <button
            type="button"
            className="btn-ghost"
            disabled={!hasNext || query.isPlaceholderData}
            onClick={() => goTo(page + 1)}
          >
            Next →
          </button>
        </nav>
      ) : null}
    </div>
  );
}

function NotableTableRow({
  row,
  rank,
  teamIds,
}: {
  row: NotableRow;
  rank: number;
  teamIds: Map<string, string>;
}) {
  return (
    // The game link stretches over the whole row, so anywhere on it opens the game.
    <tr className="group relative hover:bg-tint" data-testid="notable-row">
      <td className="hidden tabular text-ink-2 sm:table-cell">{rank}</td>
      <td className="hidden tabular whitespace-nowrap text-ink-2 sm:table-cell">
        {formatDate(row.date)}
      </td>
      <td>
        <Link
          href={`/games/${row.gameId}`}
          aria-label={rowLine(row)}
          className="inline-flex flex-wrap items-center gap-x-1.5 align-middle after:absolute after:inset-0 group-hover:underline"
        >
          {/* Each logo stays on the line with its abbreviation when the row wraps. */}
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <TeamLogo teamId={teamIds.get(row.team)} abbreviation={row.team} />
            <span className="font-semibold">{row.team}</span>
          </span>{" "}
          <span>{row.verb}</span>{" "}
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <TeamLogo teamId={teamIds.get(row.opponent)} abbreviation={row.opponent} />
            <span>
              {row.opponent}
              {row.score ? `, ${row.score}` : null}
            </span>
          </span>
        </Link>
        {row.tag ? (
          <span
            className={cn(
              "ml-2 border px-1.5 py-px text-xs",
              row.tag.tone === "win"
                ? "border-primary text-primary"
                : "border-destructive text-destructive"
            )}
          >
            {row.tag.label}
          </span>
        ) : null}
        {/* The date column is hidden on phones, so the date leads this line there. */}
        <span className="mt-0.5 block text-xs text-ink-2">
          <span className="sm:hidden">
            {formatDate(row.date)}
            {row.context || row.note ? " · " : null}
          </span>
          {row.context}
          {row.context && row.note ? " · " : null}
          {row.note ? <span className="text-primary">{row.note}</span> : null}
        </span>
      </td>
      <td className="text-right">
        <span className="tabular block text-lg leading-tight font-semibold">{row.headline}</span>
        {row.headlineNote ? (
          <span className="tabular block text-xs text-ink-2">{row.headlineNote}</span>
        ) : null}
      </td>
      <td className="tabular text-right whitespace-nowrap">{row.secondary}</td>
      <td className="text-right text-ink-3 group-hover:text-primary" aria-hidden="true">
        →
      </td>
    </tr>
  );
}
