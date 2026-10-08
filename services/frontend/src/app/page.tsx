"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { TeamAbbrLink, TeamLogo } from "@/components/team-logo";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import {
  formatGamesBack,
  formatRecord,
  formatSlateDate,
  formatTimeET,
  isoDateET,
  isoDayBefore,
} from "@/lib/format";
import { teamHref, withSeason } from "@/lib/nav";
import { CONTENT_TYPE_LABELS, formatCount, rangeToDates } from "@/lib/social";
import { standingsSeed } from "@/lib/team-form";
import { cn } from "@/lib/utils";
import type { GameHighlight, LeagueGame, ScheduledGame, StandingRow } from "@/lib/types";

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
// Seeds 1-6 are in outright; 7-10 go to the play-in.
const PLAYOFF_LOCK_SEED = 6;
const SOCIAL_LIMIT = 3;
const NOTABLE_STREAK = 3;

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

  const results = sameDay(gamesQuery.data?.data ?? []);
  // Pinned to the slate above so the cards and the scores are the same night.
  const slateDate = results[0]?.game_date.slice(0, 10);
  const highlightsQuery = useQuery({
    queryKey: ["highlights", season, slateDate],
    queryFn: () =>
      api.listHighlights({
        season: season || undefined,
        game_date: slateDate,
        limit: SLATE_FETCH,
      }),
    enabled: Boolean(slateDate),
  });
  const highlights = highlightsQuery.data?.data ?? [];
  const featured = highlights.filter((highlight) => highlight.is_featured);
  const upcoming = sameDay(scheduleQuery.data?.data ?? []);
  const standings = standingsQuery.data?.data ?? [];
  const east = topConference(standings, "east");
  const west = topConference(standings, "west");

  return (
    <div className="flex flex-col">
      <h1 className="sr-only">Baseline</h1>

      <section className="border-b border-rule-strong pb-[var(--ct-space-3)]">
        <ResultsStrip
          games={results}
          highlights={highlights}
          isLoading={gamesQuery.isLoading}
          error={gamesQuery.isError ? gamesQuery.error : null}
        />
      </section>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="lg:pr-[var(--ct-space-5)]">
          {highlightsQuery.isError ? (
            <section className="border-b border-rule py-[var(--ct-space-4)]">
              <h2 className="type-module">What stood out</h2>
              <ErrorState message={queryErrorMessage(highlightsQuery.error)} />
            </section>
          ) : featured.length > 0 ? (
            <section className="border-b border-rule py-[var(--ct-space-4)]">
              <h2 className="type-module mb-3">What stood out</h2>
              <ul className="grid gap-x-[var(--ct-space-5)] gap-y-[var(--ct-space-4)] sm:grid-cols-3">
                {featured.map((highlight) => (
                  <li key={highlight.highlight_id}>
                    <HighlightCard highlight={highlight} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="py-[var(--ct-space-4)]">
            <div className="mb-2 flex items-end justify-between gap-3">
              <h2 className="type-module">Standings</h2>
              <Link href={withSeason("/standings", season)} className="text-sm text-primary">
                Full standings →
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
              standings={standings}
              results={results}
            />
          </section>
          <section className="border-t border-rule py-[var(--ct-space-4)]">
            <SocialDigest />
          </section>
        </aside>
      </div>
    </div>
  );
}

function ResultsStrip({
  games,
  highlights,
  isLoading,
  error,
}: {
  games: LeagueGame[];
  highlights: GameHighlight[];
  isLoading: boolean;
  error: unknown;
}) {
  const date = games[0]?.game_date;
  const shown = games.slice(0, SLATE_LIMIT);
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
              {formatSlateDate(date)} · {games.length} {games.length === 1 ? "game" : "games"}
              {games.length > shown.length ? `, ${shown.length} shown` : ""}
            </p>
          ) : null}
        </div>
        <Link href="/games" className="text-sm text-primary">
          All results →
        </Link>
      </div>
      {isLoading ? (
        <LoadingState label="Loading recent games…" />
      ) : error ? (
        <ErrorState message={queryErrorMessage(error)} />
      ) : shown.length === 0 ? (
        <QuietNote>No games yet for this season.</QuietNote>
      ) : (
        <ul className="grid grid-cols-2 gap-x-[var(--ct-space-4)] gap-y-[var(--ct-space-3)] sm:grid-cols-3 lg:grid-cols-6">
          {shown.map((game) => (
            <li key={game.game_id}>
              <ResultCard
                game={game}
                note={highlights.find((highlight) => highlight.game_id === game.game_id)?.headline}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ResultCard({ game, note }: { game: LeagueGame; note?: string }) {
  const away = game.away_team_abbreviation ?? "Away";
  const home = game.home_team_abbreviation ?? "Home";
  const awayWon = game.winning_team_id
    ? game.winning_team_id === game.away_team_id
    : (game.away_score ?? 0) > (game.home_score ?? 0);
  return (
    <Link
      href={`/games/${game.game_id}`}
      aria-label={`${away} ${game.away_score ?? "—"}, ${home} ${game.home_score ?? "—"}: game flow`}
      className="block space-y-1 px-1 py-1 hover:bg-row-hover"
    >
      <ResultLine
        teamId={game.away_team_id}
        abbreviation={away}
        score={game.away_score}
        won={awayWon}
      />
      <ResultLine
        teamId={game.home_team_id}
        abbreviation={home}
        score={game.home_score}
        won={!awayWon}
      />
      {note ? <span className="type-caption line-clamp-2 block pt-1">{note}</span> : null}
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
    <span className={cn("flex items-center gap-1.5", won ? "font-semibold" : "text-ink-2")}>
      <TeamLogo teamId={teamId} abbreviation={abbreviation} />
      <span>{abbreviation}</span>
      <span className="tabular ml-auto">{score ?? "—"}</span>
    </span>
  );
}

// Eyebrow per highlight type. "loss" marks the ones that are bad news for the
// team they are about; everything else reads as a positive.
const HIGHLIGHT_LABELS: Record<string, { label: string; tone?: "loss" }> = {
  league_season_high: { label: "League season high" },
  season_high: { label: "Season high" },
  elite_game: { label: "Elite game" },
  big_scoring_night: { label: "Scoring night" },
  triple_double: { label: "Triple-double" },
  top_performer: { label: "Top performer" },
  scoring_duel: { label: "Scoring duel" },
  win_streak: { label: "Win streak" },
  win_streak_snapped: { label: "Streak ended", tone: "loss" },
  losing_streak: { label: "Losing streak", tone: "loss" },
  losing_streak_snapped: { label: "Skid over" },
  blown_lead: { label: "Blown lead", tone: "loss" },
  lead_changes: { label: "Back and forth" },
  overtime: { label: "Overtime" },
  blowout: { label: "Blowout" },
  upset: { label: "Upset" },
  heavyweight_clash: { label: "Heavyweights" },
};

function HighlightCard({ highlight }: { highlight: GameHighlight }) {
  const meta = HIGHLIGHT_LABELS[highlight.highlight_type];
  return (
    <Link href={`/games/${highlight.game_id}`} className="group block">
      <p
        className={cn("type-eyebrow", meta?.tone === "loss" ? "text-destructive" : "text-primary")}
      >
        {meta?.label ?? highlight.highlight_type.replaceAll("_", " ")}
      </p>
      <p className="mt-1 font-semibold leading-snug group-hover:underline">{highlight.headline}</p>
      <p className="mt-1 text-sm text-ink-2">{highlight.detail}</p>
    </Link>
  );
}

function UpcomingList({
  games,
  season,
  isLoading,
  error,
  standings,
  results,
}: {
  games: ScheduledGame[];
  season: string;
  isLoading: boolean;
  error: unknown;
  standings: StandingRow[];
  results: LeagueGame[];
}) {
  const date = games[0]?.game_date;
  const shown = games.slice(0, SLATE_LIMIT);
  const title = date && date.slice(0, 10) === isoDateET() ? "Games today" : "Next up";
  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="type-module">{title}</h2>
        {date ? <p className="type-caption">{formatSlateDate(date)} · ET</p> : null}
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
              <span className="tabular text-ink-2">
                {formatTimeET(game.start_time_et).replace(" ET", "")}
              </span>
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
              <UpcomingNote note={upcomingNote(game, standings, results)} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm">
        <Link href={withSeason("/schedule", season)} className="text-primary">
          {games.length > shown.length ? `All ${games.length} games →` : "Full schedule →"}
        </Link>
      </p>
    </>
  );
}

// Fixed team columns: an auto-width one lets a wider abbreviation push the "@"
// and the home team out of line with the rows above. 3.75rem is a logo plus a
// three-letter abbreviation with nothing to spare, so the "@" sits evenly
// between the two teams instead of hugging the home logo.
const UPCOMING_GRID = "grid grid-cols-[4.25rem_3.75rem_auto_3.75rem_1fr] items-center gap-x-2";

// Under the matchup, not beside it: with logos and a network tag the rail has
// no room for another column.
// A module with nothing to show says so in a line. The full-height EmptyState
// is for a page with nothing on it, and three of those push the desk off-screen.
function QuietNote({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-ink-2">{children}</p>;
}

function UpcomingNote({ note }: { note: string | null }) {
  if (!note) return null;
  return <span className="type-caption col-span-4 col-start-2">{note}</span>;
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
                className="line-clamp-3 text-[var(--ct-fs-cell)] leading-snug hover:underline"
              >
                {post.title}
              </a>
              <p className="type-caption mt-1 flex flex-wrap gap-x-3">
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
            <th className="text-right">GB</th>
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

// One short reason to care about a game, from data already on the page: a team
// on the second night of a back-to-back, else the longer notable streak.
function upcomingNote(game: ScheduledGame, standings: StandingRow[], results: LeagueGame[]) {
  const sides = [
    { id: game.away_team_id, abbreviation: game.away_team_abbreviation },
    { id: game.home_team_id, abbreviation: game.home_team_abbreviation },
  ];
  if (results[0]?.game_date.slice(0, 10) === isoDayBefore(game.game_date)) {
    const tired = sides.filter((side) =>
      results.some((result) => result.home_team_id === side.id || result.away_team_id === side.id)
    );
    if (tired.length === 2) return "Both on a back-to-back";
    if (tired.length === 1) return `${tired[0].abbreviation} on a back-to-back`;
  }
  const streaks = sides
    .map((side) => {
      const streak = standings.find((row) => row.team_id === side.id)?.streak ?? "";
      return { label: `${side.abbreviation} ${streak}`, length: Number(streak.slice(1)) || 0 };
    })
    .filter((streak) => streak.length >= NOTABLE_STREAK)
    .sort((left, right) => right.length - left.length);
  return streaks[0]?.label ?? null;
}

function topConference(rows: StandingRow[], prefix: string) {
  return rows
    .filter((row) => row.conference.toLowerCase().startsWith(prefix))
    .sort(compareSnapshotRows);
}

function compareSnapshotRows(a: StandingRow, b: StandingRow) {
  const seedA = standingsSeed(a);
  const seedB = standingsSeed(b);
  if (seedA != null && seedB != null) {
    return seedA - seedB;
  }
  if (seedA != null) return -1;
  if (seedB != null) return 1;
  const winDiff = (b.win_pct ?? -1) - (a.win_pct ?? -1);
  if (winDiff !== 0) return winDiff;
  return a.team_name.localeCompare(b.team_name);
}
