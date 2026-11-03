"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { CapPosition } from "@/components/teams/cap-position";
import { SeasonCalendar } from "@/components/teams/season-calendar";
import { TeamOverview } from "@/components/teams/team-overview";
import { TeamRoster } from "@/components/teams/team-roster";
import { TeamStats } from "@/components/teams/team-stats";
import { TeamTabs } from "@/components/teams/team-tabs";
import { TransactionList } from "@/components/transactions/transaction-list";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamLogo } from "@/components/team-logo";
import { useProfile } from "@/hooks/use-profile";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import { slugifyName, teamHref } from "@/lib/nav";
import { formatOrdinal, formatRecord, formatWeekdayDate, isoDateET } from "@/lib/format";
import { isOut, lastGames, nextGame, parseTeamTab, teamTabHref } from "@/lib/team-page";
import { showsPlayIn, showsPlayoffs, streakFromGames } from "@/lib/team-form";
import { formatGameTime } from "@/lib/timezones";
import type { TeamSeasonGame } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseTeamTab(searchParams.get("tab"));
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
      router.replace(
        teamTabHref(teamHref(team.team_name), new URLSearchParams(season ? { season } : {}), tab)
      );
    }
  }, [routeSlug, router, season, tab, team]);

  const seasonGamesQuery = useQuery({
    queryKey: ["team", teamId, "season-games", season],
    queryFn: () => api.getTeamSeasonGames(teamId, { season: season || undefined }),
    enabled: Boolean(teamId) && !seasonsLoading,
  });
  // Always loaded: the Roster badge counts who is out, whichever tab is open.
  const injuriesQuery = useQuery({
    queryKey: ["team", teamId, "injuries"],
    queryFn: () => api.listInjuries({ team_id: teamId }),
    enabled: Boolean(teamId),
  });
  const statsQuery = useQuery({
    queryKey: ["team", teamId, "stats"],
    queryFn: () => api.getTeamStats(teamId),
    enabled: Boolean(teamId) && (tab === "overview" || tab === "stats"),
  });
  const rosterQuery = useQuery({
    queryKey: ["team", teamId, "roster"],
    queryFn: () => api.getTeamRoster(teamId),
    enabled: Boolean(teamId) && tab === "roster",
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

  const standing = team.standing;
  const headerRecord = team.season_record;
  const seasonGames = seasonGamesQuery.data?.data ?? [];
  const regularSeasonGames = seasonGames.filter(
    (game) => (game.season_type ?? "Regular Season") === "Regular Season"
  );
  const streak =
    standing?.streak || streakFromGames(lastGames(regularSeasonGames, regularSeasonGames.length));
  const hasSeasonGames = (headerRecord?.games ?? 0) > 0;
  const rankLine =
    hasSeasonGames && standing?.conference_rank != null
      ? `${formatOrdinal(standing.conference_rank)} in ${standing.conference}`
      : null;
  // TeamRecord.games is optional; a missing count reads as zero so the item hides.
  const playInGames = team.play_in_record?.games ?? 0;
  const playoffGames = team.playoff_record?.games ?? 0;
  const upcoming = nextGame(seasonGames, isoDateET());
  const injuries = injuriesQuery.data?.data;
  const outCount = (injuries ?? []).filter(isOut).length;
  const seasonStats = statsQuery.data?.data.find((row) => row.split === "season") ?? null;

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        <Link href="/teams" className="hover:text-foreground">
          Teams
        </Link>
        {" / "}
        {team.team_name}
      </p>

      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex items-center gap-4">
          <TeamLogo teamId={team.team_id} abbreviation={team.abbreviation} size={56} />
          <div>
            <h1 className="type-entity">{team.team_name}</h1>
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
        </div>
        <dl
          data-testid="team-season-kpis"
          className="flex flex-wrap items-baseline justify-end gap-y-2 text-sm text-ink-2"
        >
          <HeaderItem
            testId="team-kpi-record"
            label={[team.record_season, "Regular Season record"].filter(Boolean).join(" ")}
          >
            <span className="text-2xl font-semibold text-foreground tabular">
              {headerRecord ? formatRecord(headerRecord.wins, headerRecord.losses) : "—"}
            </span>
            {rankLine ? <span className="ml-2">{rankLine}</span> : null}
          </HeaderItem>
          {showsPlayIn(playInGames, seasonGames) ? (
            <HeaderItem testId="team-kpi-play-in" label="Play-in record">
              Play-in{" "}
              <span className="font-semibold text-foreground tabular">
                {team.play_in_record && playInGames > 0
                  ? formatRecord(team.play_in_record.wins, team.play_in_record.losses)
                  : "—"}
              </span>
            </HeaderItem>
          ) : null}
          {showsPlayoffs(team.record_season, playoffGames, seasonGames) ? (
            <HeaderItem testId="team-kpi-playoffs" label="Playoff record">
              Playoffs{" "}
              <span className="font-semibold text-foreground tabular">
                {team.playoff_record && playoffGames > 0
                  ? formatRecord(team.playoff_record.wins, team.playoff_record.losses)
                  : "—"}
              </span>
            </HeaderItem>
          ) : null}
          {streak ? (
            <HeaderItem testId="team-kpi-streak" label="Streak">
              Streak{" "}
              <span
                className={cn(
                  "font-semibold",
                  streak.startsWith("W") ? "text-primary" : "text-destructive"
                )}
              >
                {streak}
              </span>
            </HeaderItem>
          ) : null}
          {upcoming ? (
            <HeaderItem testId="team-kpi-next" label="Next game">
              <NextGame game={upcoming} timezone={timezone} />
            </HeaderItem>
          ) : null}
        </dl>
      </div>

      <TeamTabs active={tab} pathname={pathname} params={searchParams} outCount={outCount} />

      {tab === "overview" ? (
        <TeamOverview
          seasonStats={seasonStats}
          games={seasonGames}
          injuries={injuries}
          injuriesLoading={injuriesQuery.isLoading}
          injuriesError={injuriesQuery.error}
          scheduleHref={teamTabHref(pathname, searchParams, "schedule")}
          rosterHref={teamTabHref(pathname, searchParams, "roster")}
        />
      ) : null}

      {tab === "stats" ? (
        statsQuery.isLoading ? (
          <LoadingState label="Loading stats…" />
        ) : statsQuery.isError ? (
          <ErrorState message={queryErrorMessage(statsQuery.error)} />
        ) : (
          <TeamStats splits={statsQuery.data?.data ?? []} />
        )
      ) : null}

      {tab === "roster" ? (
        rosterQuery.isLoading ? (
          <LoadingState label="Loading roster…" />
        ) : rosterQuery.isError ? (
          <ErrorState message={queryErrorMessage(rosterQuery.error)} />
        ) : (
          <TeamRoster
            players={rosterQuery.data?.data ?? []}
            injuries={injuries ?? []}
            abbreviation={team.abbreviation}
          />
        )
      ) : null}

      {tab === "schedule" ? (
        seasonGamesQuery.isLoading ? (
          <LoadingState label="Loading season…" />
        ) : seasonGamesQuery.isError ? (
          <ErrorState message={queryErrorMessage(seasonGamesQuery.error)} />
        ) : seasonGames.length === 0 ? (
          <EmptyState message="No games on the schedule for this season yet." />
        ) : (
          <SeasonCalendar key={`${teamId}-${season}`} games={seasonGames} timezone={timezone} />
        )
      ) : null}

      {tab === "cap" ? <CapPosition team={team} /> : null}

      {tab === "moves" ? (
        <TransactionList
          title="Recent moves"
          filter={{ team_abbreviation: team.abbreviation }}
          emptyMessage="No moves on file for this team."
        />
      ) : null}
    </div>
  );
}

function HeaderItem({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="border-l border-border px-5 first:border-l-0 first:pl-0 last:pr-0"
    >
      <dt className="sr-only">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** "Next vs MIN Wed, Nov 4, 7:30 PM ET". */
function NextGame({ game, timezone }: { game: TeamSeasonGame; timezone: string | null }) {
  const tip = formatGameTime(game.game_date, game.start_time_et, timezone);
  return (
    <Link href={`/games/${game.game_id}`} className="hover:underline">
      Next{" "}
      <span className="font-semibold text-primary">
        {game.is_home ? "vs" : "@"} {game.opponent_abbreviation ?? "—"}
      </span>{" "}
      {formatWeekdayDate(game.game_date)}
      {game.start_time_et ? `, ${tip.time}${tip.zone ? ` ${tip.zone}` : ""}` : ""}
    </Link>
  );
}
