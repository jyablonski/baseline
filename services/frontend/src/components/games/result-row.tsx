import Link from "next/link";

import { ResultTags } from "@/components/games/result-tags";
import { TeamLogo } from "@/components/team-logo";
import { pickedTeam } from "@/lib/picks";
import { resultSides } from "@/lib/results";
import type { LeagueGame, UserPick } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * A finished game: winner, score, loser, tags and the lead highlight, linking
 * to its game page. With `showPicks` a right-hand cell holds the visitor's
 * settled pick on it, empty when they made none.
 */
export function ResultRow({
  game,
  pick,
  showPicks = false,
  followed = false,
}: {
  game: LeagueGame;
  pick?: UserPick;
  showPicks?: boolean;
  /** A followed team played: the row is tinted. */
  followed?: boolean;
}) {
  const { winner, loser } = resultSides(game);
  const label = `${winner.abbreviation} ${winner.score ?? ""}, ${loser.abbreviation} ${loser.score ?? ""}`;
  return (
    <li
      className={cn("border-b border-rule", followed && "bg-tint")}
      data-testid="result-row"
      data-followed={followed || undefined}
    >
      {/* On phones the highlight wraps under the score and the arrow stays at the end of the first line. */}
      <Link
        href={`/games/${game.game_id}`}
        aria-label={label}
        // pr-3 matches .data-table's cell padding.
        className="group flex flex-wrap items-center gap-x-6 gap-y-1 py-3 pr-3 hover:bg-tint"
      >
        <span className="flex items-center gap-2 whitespace-nowrap">
          <TeamLogo teamId={winner.teamId} abbreviation={winner.abbreviation} />
          <span className="w-10 font-semibold">{winner.abbreviation}</span>
          <span className="tabular w-24 text-center text-lg">
            <span className="font-semibold">{winner.score}</span>
            <span className="px-1 text-ink-3">–</span>
            <span className="text-ink-2">{loser.score}</span>
          </span>
          <TeamLogo teamId={loser.teamId} abbreviation={loser.abbreviation} />
          <span className="w-10 text-ink-2">{loser.abbreviation}</span>
        </span>
        {/* Holds its width when empty so every highlight starts in the same column. */}
        <span className="max-sm:empty:hidden sm:w-44 sm:shrink-0">
          <ResultTags game={game} />
        </span>
        <span className="order-last basis-full truncate text-sm text-ink-2 sm:order-none sm:flex-1 sm:basis-auto">
          {game.lead_highlight}
        </span>
        {showPicks ? <SettledPick pick={pick} /> : null}
        <span aria-hidden="true" className="ml-auto text-ink-3 group-hover:text-primary">
          →
        </span>
      </Link>
    </li>
  );
}

/** "✓ You: DAL" in green for a win, "✗ You: BOS" in red for a loss; the side alone while it grades. */
function SettledPick({ pick }: { pick: UserPick | undefined }) {
  const team = pick && pick.result !== "void" ? pickedTeam(pick) : null;
  return (
    <span
      className={cn(
        "text-sm whitespace-nowrap sm:min-w-24 sm:text-right max-sm:empty:hidden",
        pick?.result === "won" && "text-primary",
        pick?.result === "lost" && "text-destructive",
        pick?.result === "pending" && "text-ink-2"
      )}
      data-testid="settled-pick"
    >
      {team
        ? `${pick?.result === "won" ? "✓ " : pick?.result === "lost" ? "✗ " : ""}You: ${team}`
        : null}
    </span>
  );
}
