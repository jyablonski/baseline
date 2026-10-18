"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { InjuryList } from "@/components/injuries/injury-list";
import { CapPosition } from "@/components/teams/cap-position";
import { SeasonCalendar } from "@/components/teams/season-calendar";
import { TransactionList } from "@/components/transactions/transaction-list";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamLogo } from "@/components/team-logo";
import { useProfile } from "@/hooks/use-profile";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import { slugifyName, teamHref, withSeason } from "@/lib/nav";
import { formatGamesBack, formatOrdinal, formatRecord, formatRecordWithWinPct } from "@/lib/format";
import { lastTenFromGames, showsPlayIn, showsPlayoffs, streakFromGames } from "@/lib/team-form";
import type { PlayerInjury, TeamSeasonGame } from "@/lib/types";

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
  const { season, isLoading: seasonsLoading } = useSeason();
  const { timezone } = useProfile();

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
  });
  const resolvedTeam = (teamsQuery.data?.data ?? []).find(
    (item) =>
      slugifyName(item.team_name) === slugifyName(routeSlug) ||
      slugifyName(item.abbreviation) === slugifyName(routeSlug)
  );
  const teamId = String(resolvedTeam?.team_id ?? "");
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

  const seasonGamesQuery = useQuery({
    queryKey: ["team", teamId, "season-games", season],
    queryFn: () => api.getTeamSeasonGames(teamId, { season: season || undefined }),
    enabled: Boolean(teamId) && !seasonsLoading,
  });
  const injuriesQuery = useQuery({
    queryKey: ["team", teamId, "injuries"],
    queryFn: () => api.listInjuries({ team_id: teamId }),
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

  if (teamsQuery.isLoading) {
    return <LoadingState label="Loading team…" />;
  }

  if (teamsQuery.isError) {
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
  const last10 = standing?.last_10 || lastTenFromGames(formQuery.data?.data ?? []);
  const streak = standing?.streak || streakFromGames(formQuery.data?.data ?? []);
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

  // TeamRecord.games is optional; a missing count reads as zero so the KPI hides.
  const playInGames = team.play_in_record?.games ?? 0;
  const playoffGames = team.playoff_record?.games ?? 0;
  const seasonGames = seasonGamesQuery.data?.data ?? [];

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
          {showsPlayIn(playInGames, seasonGames) ? (
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
          ) : null}
          {showsPlayoffs(headerSeason, playoffGames, seasonGames) ? (
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
          ) : null}
          <SeasonKpi
            testId="team-kpi-last-10"
            label="Last 10"
            value={last10 ?? "—"}
            subtext={streak ? `Streak ${streak}` : null}
          />
        </dl>
      </div>

      <CapPosition team={team} />

      <TeamInjuries
        injuries={injuriesQuery.data?.data}
        isLoading={injuriesQuery.isLoading}
        error={injuriesQuery.error}
      />

      <section>
        <h2 className="type-module mb-3">
          {seasonGamesTitle(season, seasonGamesQuery.data?.data)}
        </h2>
        {seasonGamesQuery.isLoading ? (
          <LoadingState label="Loading season…" />
        ) : seasonGamesQuery.isError ? (
          <ErrorState message={queryErrorMessage(seasonGamesQuery.error)} />
        ) : (seasonGamesQuery.data?.data ?? []).length === 0 ? (
          <EmptyState message="No games on the schedule for this season yet." />
        ) : (
          <SeasonCalendar
            key={`${teamId}-${season}`}
            games={seasonGamesQuery.data?.data ?? []}
            timezone={timezone}
          />
        )}
      </section>

      <TransactionList
        title="Recent moves"
        filter={{ team_abbreviation: team.abbreviation }}
        emptyMessage="No moves on file for this team."
      />
    </div>
  );
}

/** "2026-27 season · 3–1", the record counted from the games' own results. */
function seasonGamesTitle(season: string, games: TeamSeasonGame[] | undefined) {
  const label = `${games?.[0]?.season ?? season} season`;
  if (!games) return label;
  const wins = games.filter((game) => game.result === "W").length;
  const losses = games.filter((game) => game.result === "L").length;
  return `${label} · ${formatRecord(wins, losses)}`;
}

function TeamInjuries({
  injuries,
  isLoading,
  error,
}: {
  injuries: PlayerInjury[] | undefined;
  isLoading: boolean;
  error: unknown;
}) {
  return (
    <section>
      <h2 className="type-module border-b border-rule-strong pb-2">Injury report</h2>
      {isLoading ? (
        <LoadingState label="Loading injuries…" />
      ) : error ? (
        <ErrorState message={queryErrorMessage(error)} />
      ) : !injuries || injuries.length === 0 ? (
        <p className="py-3 text-sm text-ink-2">Nobody on the injury report.</p>
      ) : (
        <InjuryList injuries={injuries} />
      )}
    </section>
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
