import Link from "next/link";

import { InjuryReportRow } from "@/components/games/game-injuries";
import { TeamLogo } from "@/components/team-logo";
import { formatProbability, formatRecord, formatSeasonType } from "@/lib/format";
import { formatMatchupTitle } from "@/lib/game-flow";
import {
  contextLine,
  homeWon,
  isSeriesStage,
  stageOf,
  stageRecords,
  type Meeting,
  type Stage,
  type StageRecord,
} from "@/lib/game-story";
import { teamHref, withSeason } from "@/lib/nav";
import { formatGameTime } from "@/lib/timezones";
import type { GameDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

const HEADER_LOGO_SIZE = 56;

export function isFinal(game: GameDetail) {
  return game.status === "Final" && game.home_score != null && game.away_score != null;
}

function winnerId(game: GameDetail) {
  if (!isFinal(game)) return null;
  return homeWon(game) ? game.home_team_id : game.away_team_id;
}

function sides(game: GameDetail) {
  return {
    away: {
      teamId: game.away_team_id,
      abbreviation: game.away_team_abbreviation ?? "Away",
      name: game.away_team_name ?? game.away_team_abbreviation ?? "Away",
      score: game.away_score,
      wins: game.away_wins,
      losses: game.away_losses,
      streak: game.away_streak,
      winProbability: game.away_win_probability,
    },
    home: {
      teamId: game.home_team_id,
      abbreviation: game.home_team_abbreviation ?? "Home",
      name: game.home_team_name ?? game.home_team_abbreviation ?? "Home",
      score: game.home_score,
      wins: game.home_wins,
      losses: game.home_losses,
      streak: game.home_streak,
      winProbability: game.home_win_probability,
    },
  };
}

type Side = ReturnType<typeof sides>["home"];

// Records count the game's own season type, so a playoff game shows a playoff
// record; say so, or "15–3" reads as the season.
function recordSuffix(game: GameDetail) {
  if (!game.season_type || game.season_type === "Regular Season") return "";
  return ` in ${formatSeasonType(game.season_type).toLowerCase()}`;
}

/**
 * The scoreboard: each team's name, record and logo flanking the score, or
 * the tip time before the game. The sections under it stay left-aligned.
 */
export function GameHeader({
  game,
  meetings,
  meetingsLoading,
  timezone,
  tipped,
}: {
  game: GameDetail;
  meetings: Meeting[];
  /** The context ("NBA Finals, Game 5") waits for the meetings it is read from. */
  meetingsLoading: boolean;
  timezone: string | null;
  tipped: boolean;
}) {
  const tip = formatGameTime(game.game_date, game.start_time_et, timezone);
  const final = isFinal(game);
  const winner = winnerId(game);
  const { away, home } = sides(game);
  const suffix = recordSuffix(game);
  const context = meetingsLoading ? null : contextLine(game, meetings);
  const meta = [tip.date, context, game.arena || game.arena_city].filter(Boolean);
  const under = [tipped ? null : tip.zone, game.national_tv].filter(Boolean).join(" · ");

  return (
    <header className="space-y-5 border-b border-rule-strong pb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-ink-2">
        {/* A finished game goes back to its day on Games; an upcoming one to the schedule. */}
        {final ? (
          <Link href={`/games?date=${game.game_date.slice(0, 10)}`} className="hover:text-primary">
            ← Games
          </Link>
        ) : (
          <Link href="/schedule" className="hover:text-primary">
            ← Schedule
          </Link>
        )}
        <p data-testid="game-meta">{meta.join(" · ")}</p>
      </div>
      <h1 className="sr-only">{formatMatchupTitle({ ...game, winning_team_id: winner })}</h1>

      <div
        className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6"
        data-testid="game-scoreline"
      >
        <TeamSide side={away} season={game.season} suffix={suffix} />
        <div className="flex items-center justify-center gap-3 sm:gap-5">
          {final ? (
            <>
              <Score side={away} won={winner === away.teamId} />
              <span className="type-eyebrow text-foreground">Final</span>
              <Score side={home} won={winner === home.teamId} />
            </>
          ) : (
            <div className="text-center">
              <p className="text-3xl font-semibold tabular sm:text-4xl">
                {tipped ? "Tipped off" : tip.time}
              </p>
              {under ? <p className="text-sm text-ink-2">{under}</p> : null}
            </div>
          )}
        </div>
        <TeamSide side={home} season={game.season} suffix={suffix} mirrored />
      </div>

      {tipped && !final ? (
        <p className="text-center text-sm text-ink-2">
          This game has tipped off. The final score appears here the morning after.
        </p>
      ) : null}
    </header>
  );
}

function Score({ side, won }: { side: Side; won: boolean }) {
  return (
    <span
      className={cn("text-5xl tabular sm:text-6xl", won ? "font-semibold" : "text-ink-3")}
      aria-label={`${side.abbreviation} ${side.score}${won ? ", winner" : ""}`}
    >
      {side.score}
    </span>
  );
}

function TeamSide({
  side,
  season,
  suffix,
  mirrored = false,
}: {
  side: Side;
  season: string;
  suffix: string;
  /** The home side reads logo then name, so both logos sit beside the score. */
  mirrored?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3",
        mirrored ? "text-left" : "flex-row-reverse text-right"
      )}
    >
      <TeamLogo teamId={side.teamId} abbreviation={side.abbreviation} size={HEADER_LOGO_SIZE} />
      <div className={cn(!mirrored && "ml-auto")}>
        <Link
          href={withSeason(teamHref(side.name), season)}
          className="text-lg font-semibold hover:text-primary sm:text-xl"
        >
          <span className="hidden sm:inline">{side.name}</span>
          <span className="sm:hidden">{side.abbreviation}</span>
        </Link>
        <span className="block text-sm text-ink-2 tabular">
          {formatRecord(side.wins, side.losses)}
          {suffix}
        </span>
      </div>
    </div>
  );
}

/** A label and its value, one row of a panel. */
export function PanelRow({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-4 border-b border-rule py-2 text-sm"
      data-testid={testId}
    >
      <span>{label}</span>
      <span className="text-right text-ink-2">{children}</span>
    </div>
  );
}

function formLine(side: Side) {
  const record = formatRecord(side.wins, side.losses);
  return `${side.abbreviation} ${record}${side.streak ? ` (${side.streak})` : ""}`;
}

/** What to know before the game: form, the model, injuries, TV. */
export function BeforeTipoff({ game }: { game: GameDetail }) {
  const { away, home } = sides(game);
  const unplayed = [away, home].every((side) => side.wins + side.losses === 0 && !side.streak);
  const model =
    away.winProbability != null && home.winProbability != null
      ? `${away.abbreviation} ${formatProbability(away.winProbability)} · ${home.abbreviation} ${formatProbability(home.winProbability)}`
      : "Posts closer to the game";
  return (
    <section>
      <h2 className="type-module border-b border-rule-strong pb-2">Before tip-off</h2>
      <PanelRow label="Form" testId="before-form">
        {unplayed ? "Neither team has played yet" : `${formLine(away)} · ${formLine(home)}`}
      </PanelRow>
      <PanelRow label="Model win %" testId="before-model">
        {model}
      </PanelRow>
      <InjuryReportRow game={game} final={false} />
      <PanelRow label="National TV">{game.national_tv || "Local broadcast only"}</PanelRow>
    </section>
  );
}

function recordText(game: GameDetail, record: StageRecord) {
  const { homeWins, awayWins } = record;
  if (homeWins + awayWins === 0) return "No games played";
  if (homeWins === awayWins) return `Tied ${homeWins}–${awayWins}`;
  return homeWins > awayWins
    ? `${game.home_team_abbreviation} ${homeWins}–${awayWins}`
    : `${game.away_team_abbreviation} ${awayWins}–${homeWins}`;
}

const STAGE_TITLE: Record<Stage, string> = {
  "Regular Season": "Season series",
  "NBA Cup": "NBA Cup",
  "Play-In": "Play-In",
  Playoffs: "Playoff series",
  "NBA Finals": "Finals",
};

const STAGE_LABEL: Record<Stage, string> = {
  "Regular Season": "Regular season",
  "NBA Cup": "NBA Cup",
  "Play-In": "Play-In",
  Playoffs: "Playoffs",
  "NBA Finals": "NBA Finals",
};

/**
 * The meetings in this game's stage: the season series for a regular-season
 * game, the series itself for a playoff game, numbered G1, G2, ...
 */
export function SeriesPanel({
  game,
  meetings,
  timezone,
}: {
  game: GameDetail;
  meetings: Meeting[];
  timezone: string | null;
}) {
  const stage = stageOf(game.season_type, game);
  const record = stageRecords(game, meetings).find((item) => item.stage === stage);
  const rows = record?.meetings ?? [];
  const index = rows.findIndex((meeting) => meeting.game_id === game.game_id);
  const played = record ? record.homeWins + record.awayWins : 0;
  const numbered = isSeriesStage(stage);
  // W/L reads from this game's winner, or the away side before it is played.
  const perspectiveAbbr =
    winnerId(game) === game.home_team_id
      ? game.home_team_abbreviation
      : game.away_team_abbreviation;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 border-b border-rule-strong pb-2">
        <h2 className="type-module">{STAGE_TITLE[stage]}</h2>
        <span className="text-sm text-ink-2 tabular" data-testid="series-record">
          {record && played > 0
            ? recordText(game, record)
            : index >= 0
              ? `${index + 1} of ${rows.length}`
              : ""}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="py-3 text-sm text-ink-2">No other meetings this season.</p>
      ) : (
        <ul>
          {rows.map((meeting, position) => {
            const current = meeting.game_id === game.game_id;
            const tip = formatGameTime(meeting.game_date, meeting.start_time_et, timezone);
            const scored = meeting.home_score != null && meeting.away_score != null;
            const matchup = scored
              ? `${meeting.away_team_abbreviation} ${meeting.away_score} @ ${meeting.home_team_abbreviation} ${meeting.home_score}`
              : `${meeting.away_team_abbreviation} @ ${meeting.home_team_abbreviation}`;
            const winnerAbbr = scored
              ? (meeting.home_score ?? 0) > (meeting.away_score ?? 0)
                ? meeting.home_team_abbreviation
                : meeting.away_team_abbreviation
              : null;
            const won = winnerAbbr === perspectiveAbbr;
            return (
              <li
                key={meeting.game_id}
                className={cn(
                  "flex items-baseline gap-4 border-b border-rule py-2 text-sm",
                  current && "bg-tint font-semibold"
                )}
                data-testid="series-meeting"
              >
                {numbered ? <span className="w-6 text-ink-3">G{position + 1}</span> : null}
                <span className="w-24 shrink-0 tabular text-ink-2">
                  {tip.date.replace(/, \d{4}$/, "")}
                </span>
                {current ? (
                  <span>{matchup}</span>
                ) : (
                  <Link
                    href={`/games/${meeting.game_id}`}
                    className="hover:text-primary hover:underline"
                  >
                    {matchup}
                  </Link>
                )}
                <span className="ml-auto text-xs">
                  {winnerAbbr ? (
                    <span
                      className={cn("font-semibold", won ? "text-primary" : "text-destructive")}
                      title={`${perspectiveAbbr} ${won ? "won" : "lost"}`}
                    >
                      {won ? "W" : "L"}
                    </span>
                  ) : current ? (
                    <span className="font-normal text-ink-3">This game</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The rest of the season between these two, plus the game's injury report. */
export function ThisSeasonPanel({ game, meetings }: { game: GameDetail; meetings: Meeting[] }) {
  const stage = stageOf(game.season_type, game);
  const others = stageRecords(game, meetings).filter((record) => record.stage !== stage);
  return (
    <section>
      <h2 className="type-module border-b border-rule-strong pb-2">This season</h2>
      {others.map((record) => (
        <PanelRow key={record.stage} label={STAGE_LABEL[record.stage]} testId="stage-record">
          {recordText(game, record)}
        </PanelRow>
      ))}
      <InjuryReportRow game={game} final />
    </section>
  );
}
