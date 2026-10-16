import { useQuery } from "@tanstack/react-query";

import { InjuryList } from "@/components/injuries/injury-list";
import { api, queryErrorMessage } from "@/lib/api";
import { isoDateET } from "@/lib/format";
import type { GameDetail } from "@/lib/types";

// Matches injury_upcoming_days in dbt: further out than this the report says
// nothing about the game, so the mart has no rows for it.
const UPCOMING_REPORT_DAYS = 7;

function daysUntil(gameDate: string, today: string) {
  const day = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Math.round((day(gameDate) - day(today)) / 86_400_000);
}

const ROW = "flex items-baseline justify-between gap-4 py-2 text-sm";

/**
 * The game's injury report as one panel row: a count that opens to each
 * team's list. The morning of a played game, the latest for one to come.
 */
export function InjuryReportRow({ game, final }: { game: GameDetail; final: boolean }) {
  const injuriesQuery = useQuery({
    queryKey: ["game-injuries", game.game_id],
    queryFn: () => api.getGameInjuries(game.game_id),
  });
  const injuries = injuriesQuery.data?.data ?? [];
  const tooFarOut = !final && daysUntil(game.game_date, isoDateET()) > UPCOMING_REPORT_DAYS;

  let summary: string;
  if (injuriesQuery.isLoading) summary = "Loading…";
  else if (injuriesQuery.isError) summary = queryErrorMessage(injuriesQuery.error);
  else if (tooFarOut) summary = "Shows the week before the game";
  else if (injuries.length === 0) summary = final ? "None on file" : "Nobody listed";
  else summary = `${injuries.length} listed`;

  if (tooFarOut || injuries.length === 0) {
    return (
      <div className={`${ROW} border-b border-rule`} data-testid="injury-report">
        <span>Injury report</span>
        <span className="text-right text-ink-2">{summary}</span>
      </div>
    );
  }

  const sides = [
    { side: "away", label: game.away_team_abbreviation ?? "Away" },
    { side: "home", label: game.home_team_abbreviation ?? "Home" },
  ] as const;
  return (
    <details className="group border-b border-rule" data-testid="injury-report">
      <summary className={`${ROW} cursor-pointer list-none`}>
        <span>Injury report</span>
        <span className="text-right text-ink-2">
          {summary}{" "}
          <span aria-hidden="true" className="inline-block group-open:rotate-180">
            ▾
          </span>
        </span>
      </summary>
      <div className="pb-3">
        <p className="type-caption">
          {final
            ? "The Basketball-Reference report from the morning of the game, and whether each player got on the floor."
            : "The latest Basketball-Reference injury report."}
        </p>
        {sides.map(({ side, label }) => {
          const listed = injuries.filter((injury) => injury.side === side);
          return (
            <div key={side} data-testid={`injuries-${side}`}>
              <h3 className="type-eyebrow pt-3 pb-1">{label}</h3>
              {listed.length === 0 ? (
                <p className="py-1 text-sm text-ink-2">Nobody listed.</p>
              ) : (
                <InjuryList injuries={listed} />
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
