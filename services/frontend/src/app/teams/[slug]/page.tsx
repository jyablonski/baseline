"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { CapPosition } from "@/components/teams/cap-position";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamLogo } from "@/components/team-logo";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import { isLegacyEntityId, slugifyName, teamHref, withSeason } from "@/lib/nav";
import {
  formatDate,
  formatGamesBack,
  formatNumber,
  formatOrdinal,
  formatRecord,
  formatRecordWithWinPct,
  formatScheduleDate,
  formatSignedMargin,
  formatTimeET,
  teamCentricMargin,
} from "@/lib/format";
import { lastTenFromGames, streakFromGames } from "@/lib/team-form";
import type { TeamGame } from "@/lib/types";
import { cn } from "@/lib/utils";

const GAME_PAGE_SIZE = 10;
const SCHEDULE_PAGE_SIZE = GAME_PAGE_SIZE;

export default function TeamProfilePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading team…" />}>
      <TeamProfile />
    </Suspense>
  );
}

function TeamProfile() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const routeSlug = params.slug;
  const isLegacyRoute = isLegacyEntityId(routeSlug);
  const { season: requestedSeason, isLoading: seasonsLoading } = useSeason();
  const [seasonOverride, setSeasonOverride] = useState<string | null>(null);
  const [opponentId, setOpponentId] = useState("");
  const [location, setLocation] = useState<"all" | "home" | "away">("all");
  const [gamesPage, setGamesPage] = useState(0);
  const [schedulePage, setSchedulePage] = useState(0);
  const season = seasonOverride ?? requestedSeason;

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
  });
  const resolvedTeam = (teamsQuery.data?.data ?? []).find(
    (item) =>
      slugifyName(item.team_name) === slugifyName(routeSlug) ||
      slugifyName(item.abbreviation) === slugifyName(routeSlug)
  );
  const teamId = isLegacyRoute ? routeSlug : String(resolvedTeam?.team_id ?? "");
  const teamQuery = useQuery({
    queryKey: ["team", teamId, season],
    queryFn: () => api.getTeam(teamId, { season: season || undefined }),
    enabled: Boolean(teamId) && !seasonsLoading,
  });
  const team = teamQuery.data;

  useEffect(() => {
    if (team && routeSlug !== slugifyName(team.team_name)) {
      router.replace(withSeason(teamHref(team.team_name), season));
    }
  }, [routeSlug, router, season, team]);

  const recordParams = {
    season: season || undefined,
    opponent_team_id: opponentId || undefined,
    location: location === "all" ? undefined : location,
  };

  const gamesQuery = useQuery({
    queryKey: ["team", teamId, "games", recordParams, gamesPage],
    queryFn: () =>
      api.getTeamGames(teamId, {
        ...recordParams,
        limit: GAME_PAGE_SIZE,
        offset: gamesPage * GAME_PAGE_SIZE,
      }),
    enabled: Boolean(teamId),
  });
  const remainingScheduleQuery = useQuery({
    queryKey: ["team", teamId, "remaining-schedule", recordParams, schedulePage],
    queryFn: () =>
      api.listSchedule({
        season: season || undefined,
        status: "Scheduled",
        team_id: teamId,
        opponent_team_id: opponentId || undefined,
        location: location === "all" ? undefined : location,
        limit: SCHEDULE_PAGE_SIZE,
        offset: schedulePage * SCHEDULE_PAGE_SIZE,
      }),
    enabled: Boolean(teamId && season),
  });
  const overallQuery = useQuery({
    queryKey: ["team", teamId, "record", "overall", recordParams],
    queryFn: () => api.getTeamRecord(teamId, recordParams),
    enabled: Boolean(teamId),
  });
  const standing = team?.standing;
  const headerSeason = team?.record_season;
  const needsForm = Boolean(headerSeason && (!standing?.last_10 || !standing?.streak));
  const formQuery = useQuery({
    queryKey: ["team", teamId, "form", headerSeason],
    queryFn: () =>
      api.getTeamGames(teamId, {
        season: headerSeason ?? undefined,
        season_type: "Regular Season",
        limit: 10,
      }),
    enabled: Boolean(teamId) && needsForm,
  });

  const games = gamesQuery.data?.data ?? [];
  const overall = overallQuery.data;
  const remainingSchedule = remainingScheduleQuery.data?.data ?? [];

  if (!isLegacyRoute && teamsQuery.isLoading) {
    return <LoadingState label="Loading team…" />;
  }

  if (!isLegacyRoute && teamsQuery.isError) {
    return <ErrorState message={queryErrorMessage(teamsQuery.error)} />;
  }

  if (!teamId) {
    return <ErrorState message="Team not found." />;
  }

  if (teamQuery.isLoading) {
    return <LoadingState label="Loading team…" />;
  }

  if (teamQuery.isError || !team) {
    return (
      <ErrorState
        message={teamQuery.error ? queryErrorMessage(teamQuery.error) : "Team not found."}
      />
    );
  }

  const headerRecord = team.season_record;
  const opponents = (teamsQuery.data?.data ?? []).filter((item) => item.team_id !== teamId);
  const last10 = standing?.last_10 || lastTenFromGames(formQuery.data?.data ?? []);
  const streak = standing?.streak || streakFromGames(formQuery.data?.data ?? []);
  const gamesTotal = gamesQuery.data?.meta.total ?? games.length;
  const scheduleTotal = remainingScheduleQuery.data?.meta.total ?? remainingSchedule.length;
  const gamesFrom = gamesTotal === 0 ? 0 : gamesPage * GAME_PAGE_SIZE + 1;
  const gamesTo = Math.min(gamesTotal, (gamesPage + 1) * GAME_PAGE_SIZE);
  const scheduleFrom = scheduleTotal === 0 ? 0 : schedulePage * SCHEDULE_PAGE_SIZE + 1;
  const scheduleTo = Math.min(scheduleTotal, (schedulePage + 1) * SCHEDULE_PAGE_SIZE);
  const hasSeasonGames = (team.season_record?.games ?? 0) > 0;
  const rankLine =
    hasSeasonGames && standing?.conference_rank != null
      ? `${formatOrdinal(standing.conference_rank)} in ${standing.conference}`
      : null;
  const gamesBack = hasSeasonGames ? formatGamesBack(standing?.games_back) : "—";
  const rsSubline = [
    headerRecord?.games != null ? `${headerRecord.games} games` : null,
    rankLine,
    gamesBack !== "—" ? gamesBack : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function resetFilters() {
    resetPages();
    setSeasonOverride(null);
    setOpponentId("");
    setLocation("all");
  }

  function resetPages() {
    setGamesPage(0);
    setSchedulePage(0);
  }

  // TeamRecord.games is optional; a missing count reads as zero so the KPI hides.
  const playInGames = team.play_in_record?.games ?? 0;
  const playoffGames = team.playoff_record?.games ?? 0;

  return (
    <div className="space-y-8">
      <p className="text-xs text-muted-foreground">
        <Link href="/teams" className="hover:text-foreground">
          Teams
        </Link>
        {" / "}
        {team.team_name}
      </p>

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="type-entity flex items-center gap-3">
            <TeamLogo teamId={team.team_id} abbreviation={team.abbreviation} size={36} />
            <span>{team.team_name}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[
              team.abbreviation,
              team.conference,
              team.division,
              [team.arena_name, team.city].filter(Boolean).join(", ") || null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <dl
          data-testid="team-season-kpis"
          className="flex flex-wrap items-start justify-end gap-x-2 gap-y-4"
        >
          <SeasonKpi
            testId="team-kpi-regular-season"
            label={`${headerSeason || "Season"} Regular Season`}
            value={
              headerRecord
                ? formatRecordWithWinPct(
                    headerRecord.wins,
                    headerRecord.losses,
                    headerRecord.win_pct
                  )
                : "—"
            }
            subtext={rsSubline}
          />
          <SeasonKpi
            testId="team-kpi-play-in"
            label="Play-in"
            value={
              team.play_in_record && playInGames > 0
                ? formatRecord(team.play_in_record.wins, team.play_in_record.losses)
                : "—"
            }
            subtext={playInGames > 0 ? `${playInGames} GP` : null}
          />
          <SeasonKpi
            testId="team-kpi-playoffs"
            label="Playoffs"
            value={
              team.playoff_record && playoffGames > 0
                ? formatRecord(team.playoff_record.wins, team.playoff_record.losses)
                : "—"
            }
            subtext={playoffGames > 0 ? `${playoffGames} GP` : null}
          />
          <SeasonKpi
            testId="team-kpi-last-10"
            label="Last 10"
            value={last10 ?? "—"}
            subtext={streak ? `Streak ${streak}` : null}
          />
        </dl>
      </div>

      <CapPosition team={team} />

      <div className="flex flex-wrap items-end gap-3 border-y border-border py-3">
        <p className="mr-2 type-eyebrow">Filter games</p>
        <LabeledSelect
          label="Opponent"
          value={opponentId}
          onChange={(value) => {
            setOpponentId(value);
            resetPages();
          }}
          options={[
            { value: "", label: "Any" },
            ...opponents.map((item) => ({ value: String(item.team_id), label: item.abbreviation })),
          ]}
        />
        <div className="flex border border-input">
          {(["all", "home", "away"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setLocation(value);
                resetPages();
              }}
              className={cn("seg-btn", location === value && "seg-btn-active")}
            >
              {value}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="h-8 px-2 text-sm text-muted-foreground hover:text-foreground"
          onClick={resetFilters}
        >
          Reset
        </button>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section>
          <h2 className="type-module">
            {gamesTotal ? `${formatNumber(gamesTotal)} games` : "Game results"}
            {overall
              ? ` · ${formatRecordWithWinPct(overall.wins, overall.losses, overall.win_pct)}`
              : " · —"}
          </h2>
          {gamesQuery.isLoading ? (
            <LoadingState label="Loading games…" />
          ) : gamesQuery.isError ? (
            <ErrorState message={queryErrorMessage(gamesQuery.error)} />
          ) : games.length === 0 ? (
            <EmptyState message="No games match these filters." />
          ) : (
            <table className="data-table mt-3">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Opp</th>
                  <th>Res</th>
                  <th className="text-right">Score</th>
                  <th className="text-right">Margin</th>
                  <th>Arena</th>
                  <th>PBP</th>
                </tr>
              </thead>
              <tbody>
                {games.map((game) => {
                  const view = normalizeTeamGame(game, teamId);
                  return (
                    <tr key={game.game_id}>
                      <td className="tabular">{formatDate(view.game_date)}</td>
                      <td className="font-semibold">{view.opponent}</td>
                      <td
                        className={cn(
                          "font-medium",
                          view.result === "W" && "text-primary",
                          view.result === "L" && "text-destructive"
                        )}
                      >
                        {view.result ?? "—"}
                      </td>
                      <td className="tabular text-right">
                        {view.teamScore != null && view.oppScore != null
                          ? `${view.teamScore}–${view.oppScore}`
                          : "—"}
                      </td>
                      <td className="tabular text-right">{formatSignedMargin(view.margin)}</td>
                      <td className="text-muted-foreground">{view.arena}</td>
                      <td>
                        <Link
                          href={withSeason(`/games/${game.game_id}`, view.season)}
                          className="text-primary hover:underline"
                        >
                          PBP
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <PageControls
            from={gamesFrom}
            to={gamesTo}
            total={gamesTotal}
            page={gamesPage}
            onPage={setGamesPage}
          />
        </section>

        <aside>
          <div className="border border-border p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="type-module">Remaining schedule</h2>
              {scheduleTotal > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {formatNumber(scheduleTotal)} games
                </span>
              ) : null}
            </div>
            {remainingScheduleQuery.isLoading ? (
              <LoadingState label="Loading remaining schedule…" />
            ) : remainingScheduleQuery.isError ? (
              <ErrorState message={queryErrorMessage(remainingScheduleQuery.error)} />
            ) : remainingSchedule.length === 0 ? (
              <EmptyState message="No remaining games match these filters." />
            ) : (
              <div className="mt-3 divide-y divide-border">
                {remainingSchedule.map((game) => {
                  const isHome = game.home_team_id === teamId;
                  const opponentTeamId = isHome ? game.away_team_id : game.home_team_id;
                  const opponentAbbreviation = isHome
                    ? game.away_team_abbreviation
                    : game.home_team_abbreviation;
                  const opponentName = isHome ? game.away_team_name : game.home_team_name;
                  return (
                    <div key={game.game_id} className="py-2 first:pt-0 last:pb-0">
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="whitespace-nowrap font-medium">
                          {formatScheduleDate(game.game_date)}
                        </span>
                        <span className="whitespace-nowrap tabular text-muted-foreground">
                          {formatTimeET(game.start_time_et)}
                        </span>
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-sm">
                        <span className="shrink-0 text-muted-foreground">
                          {isHome ? "vs" : "@"}
                        </span>
                        {opponentTeamId ? (
                          <Link
                            href={withSeason(
                              teamHref(opponentName ?? opponentAbbreviation ?? ""),
                              season
                            )}
                            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-semibold hover:text-primary"
                          >
                            <TeamLogo teamId={opponentTeamId} abbreviation={opponentAbbreviation} />
                            {opponentAbbreviation ?? "Opponent"}
                          </Link>
                        ) : (
                          <span className="whitespace-nowrap font-semibold">
                            {opponentAbbreviation ?? "Opponent"}
                          </span>
                        )}
                      </p>
                      {game.arena || game.arena_city ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {game.arena || game.arena_city}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            <PageControls
              from={scheduleFrom}
              to={scheduleTo}
              total={scheduleTotal}
              page={schedulePage}
              onPage={setSchedulePage}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function SeasonKpi({
  label,
  value,
  subtext,
  testId,
}: {
  label: string;
  value: string;
  subtext?: string | null;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="min-w-[7.5rem] border-l border-border px-4 first:border-l-0 first:pl-0"
    >
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1 type-hero-stat tabular">{value}</dd>
      {subtext ? <p className="mt-1 text-xs text-muted-foreground">{subtext}</p> : null}
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="text-xs text-muted-foreground">
      {label}
      <select
        className={cn("field mt-1 block", value && "field-query")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value || option.label} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PageControls({
  from,
  to,
  total,
  page,
  onPage,
}: {
  from: number;
  to: number;
  total: number;
  page: number;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="mt-3 flex items-center justify-between gap-2 text-xs">
      <p className="text-muted-foreground">
        {from}–{to} of {formatNumber(total)}
      </p>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => onPage(Math.max(0, page - 1))}
          className="btn-ghost"
        >
          ← Prev
        </button>
        <button
          type="button"
          disabled={to >= total}
          onClick={() => onPage(page + 1)}
          className="btn-ghost"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function normalizeTeamGame(game: TeamGame, teamId: string) {
  const isHome = game.location?.toLowerCase() === "home" || game.home_team_id === teamId;
  const opponent =
    game.opponent_abbreviation ??
    (isHome ? game.away_team_abbreviation : game.home_team_abbreviation) ??
    "—";
  const teamScore = isHome
    ? (game.home_score ?? game.team_score)
    : (game.away_score ?? game.team_score);
  const oppScore = isHome
    ? (game.away_score ?? game.opponent_score)
    : (game.home_score ?? game.opponent_score);
  const result =
    game.result ??
    (game.is_win == null ? null : game.is_win ? "W" : "L") ??
    (teamScore != null && oppScore != null ? (teamScore > oppScore ? "W" : "L") : null);
  const margin = teamCentricMargin(teamScore, oppScore, game.score_margin, game.is_win);
  return {
    season: game.season,
    game_date: game.game_date,
    opponent,
    result,
    teamScore,
    oppScore,
    margin,
    arena: game.arena ?? game.arena_city ?? "—",
  };
}
