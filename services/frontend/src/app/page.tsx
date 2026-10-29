"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { GamesBackHeader } from "@/components/column-help";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { ResultTags } from "@/components/games/result-tags";
import { TeamAbbrLink, TeamLogo } from "@/components/team-logo";
import { useProfile } from "@/hooks/use-profile";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import {
  formatGamesBack,
  formatProbability,
  formatRecord,
  formatSlateDate,
  isoDateET,
  isoDayBefore,
} from "@/lib/format";
import { teamHref, withSeason } from "@/lib/nav";
import { formatDayTitle, gameOdds, rankSlate } from "@/lib/results";
import { CONTENT_TYPE_LABELS, formatCount, rangeToDates } from "@/lib/social";
import { conferenceStandings, standingsSeed } from "@/lib/team-form";
import { cn } from "@/lib/utils";
import { formatGameTime, formatScrapedAt } from "@/lib/timezones";
import type { LeagueGame, ScheduledGame, StandingRow } from "@/lib/types";

export default function HomePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading desk…" />}>
      <HomeDesk />
    </Suspense>
  );
}

// Enough for a full night: 30 teams is at most 15 games.
const SLATE_FETCH = 15;
const SLATE_LIMIT = 6;
const UPCOMING_LIMIT = 5;
// Seeds 1-6 are in outright; 7-10 go to the play-in.
const PLAYOFF_LOCK_SEED = 6;
const SOCIAL_LIMIT = 3;

function HomeDesk() {
  const { season, isLoading: seasonIsLoading } = useSeason();

  const gamesQuery = useQuery({
    queryKey: ["games", season, "latest"],
    queryFn: () =>
      api.listGames({
        season: season || undefined,
        limit: SLATE_FETCH,
      }),
  });
  // The API's default "from today" is the server's UTC date, which rolls over
  // at 8pm Eastern and would drop tonight's late games off this list.
  const today = isoDateET();
  const scheduleQuery = useQuery({
    queryKey: ["schedule", season, "next", today],
    queryFn: () =>
      api.listSchedule({
        season: season || undefined,
        status: "Scheduled",
        from_date: today,
        limit: SLATE_FETCH,
      }),
    enabled: !seasonIsLoading,
  });
  const standingsQuery = useQuery({
    queryKey: ["standings", season],
    queryFn: () => api.listStandings({ season: season || undefined }),
  });

  const { timezone } = useProfile();
  const statusQuery = useQuery({
    queryKey: ["status"],
    queryFn: () => api.getStatus(),
  });

  const results = sameDay(gamesQuery.data?.data ?? []);
  const upcoming = sameDay(scheduleQuery.data?.data ?? []);
  const standings = standingsQuery.data?.data ?? [];
  const east = conferenceStandings(standings, "east");
  const west = conferenceStandings(standings, "west");

  return (
    <div className="flex flex-col">
      <h1 className="sr-only">Baseline</h1>

      <section className="border-b border-rule-strong pb-[var(--ct-space-3)]">
        <ResultsStrip
          games={results}
          isLoading={gamesQuery.isLoading}
          error={gamesQuery.isError ? gamesQuery.error : null}
        />
      </section>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="lg:pr-[var(--ct-space-5)]">
          <section className="py-[var(--ct-space-4)]">
            <div className="mb-2 flex items-end justify-between gap-3">
              <h2 className="type-module">Standings</h2>
              <Link href={withSeason("/teams", season)} className="text-sm text-primary">
                Teams →
              </Link>
            </div>
            {standingsQuery.isLoading ? (
              <LoadingState label="Loading standings…" />
            ) : standingsQuery.isError ? (
              <ErrorState message={queryErrorMessage(standingsQuery.error)} />
            ) : east.length === 0 && west.length === 0 ? (
              <EmptyState
                title="No standings yet"
                message={`No Regular Season games or official standings for ${season || "this season"}.`}
              />
            ) : (
              <div className="grid gap-x-10 gap-y-4 md:grid-cols-2">
                <ConferenceTable title="East" rows={east} season={season} />
                <ConferenceTable title="West" rows={west} season={season} />
              </div>
            )}
          </section>
        </div>

        <aside className="border-t border-rule lg:border-t-0 lg:border-l lg:pl-[var(--ct-space-5)]">
          <section className="py-[var(--ct-space-4)]">
            <UpcomingList
              games={upcoming}
              season={season}
              isLoading={seasonIsLoading || scheduleQuery.isLoading}
              error={scheduleQuery.isError ? scheduleQuery.error : null}
            />
          </section>
          <section className="border-t border-rule py-[var(--ct-space-4)]">
            <SocialDigest />
          </section>
        </aside>
      </div>

      <p className="type-caption tabular border-t border-rule pt-[var(--ct-space-3)]">
        Data as of {formatScrapedAt(statusQuery.data?.last_scraped_at, timezone)}
      </p>
    </div>
  );
}

function ResultsStrip({
  games,
  isLoading,
  error,
}: {
  games: LeagueGame[];
  isLoading: boolean;
  error: unknown;
}) {
  const date = games[0]?.game_date;
  const shown = rankSlate(games).slice(0, SLATE_LIMIT);
  const day = date?.slice(0, 10);
  // The scrape lands the morning after, so "last night" only holds until the
  // next one; an off day or the offseason shows an older slate.
  const title =
    date && date.slice(0, 10) === isoDayBefore(isoDateET()) ? "Last night" : "Latest results";
  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="type-module">{title}</h2>
          {date ? (
            <p className="text-sm text-ink-2">
              {formatDayTitle(date.slice(0, 10))} · {games.length}{" "}
              {games.length === 1 ? "game" : "games"}
            </p>
          ) : null}
        </div>
        {/* Pinned to the night, so it still lands there once a newer slate is in. */}
        <Link href={day ? `/games?date=${day}` : "/games"} className="text-sm text-primary">
          See all latest results →
        </Link>
      </div>
      {isLoading ? (
        <LoadingState label="Loading recent games…" />
      ) : error ? (
        <ErrorState message={queryErrorMessage(error)} />
      ) : shown.length === 0 ? (
        <QuietNote>No games yet for this season.</QuietNote>
      ) : (
        // Every card rules its right edge and the list runs a pixel past its
        // clip, so the last column's rule is hidden at any column count.
        <div className="overflow-hidden">
          <ul
            className={cn(
              "-mr-px grid border-t border-rule-strong [&>li]:border-r [&>li]:border-b [&>li]:border-rule",
              shown.length > 1 && "sm:grid-cols-2",
              RESULT_COLUMNS[shown.length]
            )}
          >
            {shown.map((game) => (
              <li key={game.game_id}>
                <ResultCard game={game} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// Columns follow the night so a short slate fills the row: one row up to
// four games, five once there is room for them, six as two rows of three.
const RESULT_COLUMNS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-3 xl:grid-cols-5",
  6: "lg:grid-cols-3",
};

function ResultCard({ game }: { game: LeagueGame }) {
  const away = game.away_team_abbreviation ?? "Away";
  const home = game.home_team_abbreviation ?? "Home";
  const odds = gameOdds(game);
  // Market only: the home page does not show Baseline's own model.
  const market = odds.market
    ? `Market favored ${odds.market.abbreviation} ${formatProbability(odds.market.wp)}`
    : null;
  return (
    <Link
      href={`/games/${game.game_id}`}
      aria-label={`${away} ${game.away_score ?? "—"}, ${home} ${game.home_score ?? "—"}: game flow`}
      className="block h-full space-y-1.5 px-[var(--ct-space-3)] py-[var(--ct-space-3)] hover:bg-row-hover"
    >
      <ResultLine
        teamId={game.away_team_id}
        abbreviation={away}
        score={game.away_score}
        won={!odds.homeWon}
      />
      <ResultLine
        teamId={game.home_team_id}
        abbreviation={home}
        score={game.home_score}
        won={odds.homeWon}
      />
      {game.lead_highlight ? (
        <span className="line-clamp-2 block pt-1 text-sm">{game.lead_highlight}</span>
      ) : null}
      {market || odds.isUpset || odds.isComeback ? (
        <span className="type-caption flex flex-wrap items-center gap-x-2 gap-y-1">
          <ResultTags game={game} odds={odds} />
          {market ? <span>{market}</span> : null}
        </span>
      ) : null}
    </Link>
  );
}

function ResultLine({
  teamId,
  abbreviation,
  score,
  won,
}: {
  teamId: string | undefined;
  abbreviation: string;
  score: number | null | undefined;
  won: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2 text-lg", won ? "font-semibold" : "text-ink-2")}>
      <TeamLogo teamId={teamId} abbreviation={abbreviation} />
      <span>{abbreviation}</span>
      <span className="tabular ml-auto">{score ?? "—"}</span>
    </span>
  );
}

function UpcomingList({
  games,
  season,
  isLoading,
  error,
}: {
  games: ScheduledGame[];
  season: string;
  isLoading: boolean;
  error: unknown;
}) {
  const { timezone } = useProfile();
  const date = games[0]?.game_date;
  const shown = games.slice(0, UPCOMING_LIMIT);
  // The heading names the zone once for every time under it. A game with no
  // start time has no zone to give, so the first one that does speaks for all.
  const zone =
    shown
      .map((game) => formatGameTime(game.game_date, game.start_time_et, timezone).zone)
      .find(Boolean) || "ET";
  const title = date && date.slice(0, 10) === isoDateET() ? "Games today" : "Next up";
  return (
    <>
      {/* The rail is narrow: the link holds the top right beside the title and
          the date drops to its own line, rather than the link wrapping under. */}
      <div className="mb-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="type-module">{title}</h2>
          <Link
            href={withSeason("/schedule", season)}
            className="text-sm whitespace-nowrap text-primary"
          >
            See full schedule →
          </Link>
        </div>
        {date ? (
          <p className="type-caption mt-0.5">
            {formatSlateDate(date)} · {games.length} {games.length === 1 ? "game" : "games"} ·{" "}
            {zone}
          </p>
        ) : null}
      </div>
      {isLoading ? (
        <LoadingState label="Loading upcoming games…" />
      ) : error ? (
        <ErrorState message={queryErrorMessage(error)} />
      ) : shown.length === 0 ? (
        <QuietNote>No upcoming games on the schedule.</QuietNote>
      ) : (
        <ul>
          {shown.map((game) => (
            <li
              key={game.game_id}
              className={cn(UPCOMING_GRID, "border-b border-rule-soft py-1.5 text-sm")}
            >
              <Link
                href={`/games/${game.game_id}`}
                className="tabular text-ink-2 hover:text-primary hover:underline"
                title="Game preview"
              >
                {formatGameTime(game.game_date, game.start_time_et, timezone).time}
              </Link>
              <TeamAbbrLink
                teamId={game.away_team_id}
                abbreviation={game.away_team_abbreviation ?? "Away"}
                href={withSeason(
                  teamHref(game.away_team_name ?? game.away_team_abbreviation ?? ""),
                  season
                )}
              />
              <span className="text-ink-3">@</span>
              <TeamAbbrLink
                teamId={game.home_team_id}
                abbreviation={game.home_team_abbreviation ?? "Home"}
                href={withSeason(
                  teamHref(game.home_team_name ?? game.home_team_abbreviation ?? ""),
                  season
                )}
              />
              {game.national_tv ? (
                <span
                  className="type-eyebrow justify-self-end whitespace-nowrap border border-rule px-1 py-0.5 tracking-normal"
                  title={`National TV: ${game.national_tv}`}
                >
                  {game.national_tv}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// Fixed team columns: an auto-width one lets a wider abbreviation push the "@"
// and the home team out of line with the rows above. 3.75rem is a logo plus a
// three-letter abbreviation with nothing to spare, so the "@" sits evenly
// between the two teams instead of hugging the home logo.
const UPCOMING_GRID = "grid grid-cols-[4.25rem_3.75rem_auto_3.75rem_1fr] items-center gap-x-2";

// A module with nothing to show says so in a line. The full-height EmptyState
// is for a page with nothing on it, and three of those push the desk off-screen.
function QuietNote({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-ink-2">{children}</p>;
}

function SocialDigest() {
  // Counted back from the newest collected post, as /social does: collection is
  // one batch a day, so a clock-anchored day is often empty.
  const anchorQuery = useQuery({
    queryKey: ["social-anchor"],
    queryFn: () => api.getSocialSummary(),
  });
  const anchorAt = anchorQuery.data?.last_post_at;
  const dateWindow = useMemo(
    () => rangeToDates("24h", anchorAt ? new Date(anchorAt) : undefined),
    [anchorAt]
  );
  const postsQuery = useQuery({
    queryKey: ["social-posts", dateWindow, "home"],
    queryFn: () => api.listSocialPosts({ ...dateWindow, sort: "score", limit: SOCIAL_LIMIT }),
    enabled: !anchorQuery.isPending,
  });
  const posts = postsQuery.data?.data ?? [];
  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="type-module">On r/nba</h2>
        <Link href="/social" className="text-sm text-primary">
          Social →
        </Link>
      </div>
      {anchorQuery.isPending || postsQuery.isLoading ? (
        <LoadingState label="Loading posts…" />
      ) : postsQuery.isError ? (
        <ErrorState message={queryErrorMessage(postsQuery.error)} />
      ) : posts.length === 0 ? (
        <QuietNote>No posts have been collected yet.</QuietNote>
      ) : (
        <ul>
          {posts.map((post) => (
            <li key={post.reddit_id} className="border-b border-rule-soft py-2 last:border-b-0">
              <a
                href={post.permalink}
                target="_blank"
                rel="noreferrer"
                title={post.title}
                className="line-clamp-3 text-[var(--ct-fs-cell)] leading-tight hover:underline"
              >
                {post.title}
              </a>
              <p className="type-caption mt-0.5 flex flex-wrap gap-x-3">
                <span>
                  <span className="tabular">{formatCount(post.score)}</span> score
                </span>
                <span>
                  <span className="tabular">{formatCount(post.num_comments)}</span> comments
                </span>
                {post.is_contested ? (
                  <span className="text-destructive">Contested</span>
                ) : (
                  <span>{CONTENT_TYPE_LABELS[post.content_type] ?? post.content_type}</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// All 30 teams have to fit on one screen beside the rest of the desk, so these
// rows are shorter than a data-table's default 40px.
const COMPACT_TABLE = "[&_tbody_tr]:h-[28px] [&_td]:py-0.5 [&_th]:py-1.5";

function ConferenceTable({
  title,
  rows,
  season,
}: {
  title: string;
  rows: StandingRow[];
  season: string;
}) {
  return (
    <div>
      <p className="type-eyebrow mb-1">{title}</p>
      <table className={cn("data-table", COMPACT_TABLE)}>
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th className="text-right">W–L</th>
            <GamesBackHeader />
            <th className="text-right">L10</th>
            <th className="text-right">Strk</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.team_id}
              className={cn(
                standingsSeed(row) === PLAYOFF_LOCK_SEED &&
                  rows.length > PLAYOFF_LOCK_SEED &&
                  "border-b-rule-strong"
              )}
            >
              <td className="tabular text-muted-foreground">{standingsSeed(row) ?? "—"}</td>
              <td>
                <TeamAbbrLink
                  teamId={row.team_id}
                  abbreviation={row.abbreviation}
                  href={withSeason(teamHref(row.team_name), season)}
                />
              </td>
              <td className="tabular text-right">{formatRecord(row.wins, row.losses)}</td>
              <td className="tabular text-right text-ink-2">{formatGamesBack(row.games_back)}</td>
              <td className="tabular text-right text-ink-2">{row.last_10 ?? "—"}</td>
              <td
                className={cn(
                  "tabular text-right",
                  row.streak?.startsWith("W") && "text-primary",
                  row.streak?.startsWith("L") && "text-destructive"
                )}
              >
                {row.streak ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The leading rows that share the first row's date: one night's slate. */
function sameDay<T extends { game_date: string }>(rows: T[]): T[] {
  const first = rows[0]?.game_date.slice(0, 10);
  return rows.filter((row) => row.game_date.slice(0, 10) === first);
}
