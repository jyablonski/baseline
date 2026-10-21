import { gameOdds } from "@/lib/results";
import type { LeagueGame } from "@/lib/types";

/**
 * Upset and Comeback tags for a Final, or nothing when neither applies. Pass
 * `odds` when the caller has already worked them out.
 */
export function ResultTags({
  game,
  odds = gameOdds(game),
}: {
  game: LeagueGame;
  odds?: ReturnType<typeof gameOdds>;
}) {
  if (!odds.isUpset && !odds.isComeback) return null;
  return (
    <span className="inline-flex items-center gap-x-2">
      {odds.isUpset ? <ResultTag>Upset</ResultTag> : null}
      {odds.isComeback ? (
        <ResultTag
          title={`${odds.winner.abbreviation} came back from ${game.largest_lead_blown} down`}
        >
          Comeback
        </ResultTag>
      ) : null}
    </span>
  );
}

function ResultTag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="type-eyebrow border border-ink px-1 tracking-normal text-ink">
      {children}
    </span>
  );
}
