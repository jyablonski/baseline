import { formatProbability } from "@/lib/format";
import { breakdownView, lineText, marketLineText } from "@/lib/model-breakdown";
import type { GameDetail } from "@/lib/types";

function Row({
  label,
  detail,
  value,
  strong = false,
  testId,
}: {
  label: string;
  detail?: string | null;
  value: string;
  strong?: boolean;
  testId?: string;
}) {
  return (
    <li
      className="flex items-baseline justify-between gap-4 border-b border-rule px-3 py-2 text-sm"
      data-testid={testId}
    >
      <span>
        <span className={strong ? "font-semibold" : undefined}>{label}</span>
        {detail ? <span className="block text-ink-3">{detail}</span> : null}
      </span>
      <span className={strong ? "tabular font-semibold" : "tabular text-ink-2"}>{value}</span>
    </li>
  );
}

/**
 * Why the live model gave this game the number it did: each part in points of
 * spread, credited to the team it favours, adding up to the model's line.
 * Nothing renders for a prediction stored before breakdowns were.
 */
export function ModelBreakdown({ game, final }: { game: GameDetail; final: boolean }) {
  const breakdown = game.prediction_breakdown;
  const homeWp = game.home_win_probability;
  if (!breakdown || homeWp == null) return null;

  const view = breakdownView(breakdown, game);
  const homeFavored = homeWp >= 0.5;
  const favourite = homeFavored ? game.home_team_abbreviation : game.away_team_abbreviation;
  const market = marketLineText(game);

  return (
    <section data-testid="model-breakdown">
      <h2 className="type-module border-b border-rule-strong pb-2">
        Why the model {final ? "had" : "has"} {favourite} at{" "}
        {formatProbability(homeFavored ? homeWp : 1 - homeWp)}
      </h2>
      <ul>
        {view.rows.map((row) => (
          <Row
            key={row.key}
            label={row.label}
            detail={row.detail}
            value={row.team ? `${row.team} +${row.points}` : "Even"}
            testId="breakdown-row"
          />
        ))}
        <Row label="Model's line" value={lineText(view)} strong testId="breakdown-line" />
        {market ? <Row label="Sportsbook line" value={market} /> : null}
      </ul>
    </section>
  );
}
