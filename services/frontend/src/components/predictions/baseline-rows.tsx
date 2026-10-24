import { formatNumber, formatProbability } from "@/lib/format";
import type { ScorecardRow } from "@/lib/types";

/**
 * The sportsbook and always-home rows every scorecard table ends with. Both
 * baselines are per season and repeated on every model row, so any row of the
 * season will do. `withNotes` adds a caption under each label.
 */
export function BaselineRows({
  baseline,
  withNotes = false,
}: {
  baseline: ScorecardRow;
  withNotes?: boolean;
}) {
  return (
    <>
      <tr>
        <td className="text-muted-foreground">
          Sportsbook market
          {withNotes ? (
            <span className="type-caption block">Implied win % from the morning line</span>
          ) : null}
        </td>
        <td className="tabular">{formatNumber(baseline.market_n)}</td>
        <td className="tabular">{formatNumber(baseline.market_logloss, 3)}</td>
        <td className="tabular">{formatNumber(baseline.market_brier, 3)}</td>
        <td className="tabular">—</td>
        <td className="tabular">—</td>
      </tr>
      <tr>
        <td className="text-muted-foreground">
          Always pick the home team
          {withNotes ? <span className="type-caption block">Baseline to beat</span> : null}
        </td>
        <td className="tabular">{formatNumber(baseline.n)}</td>
        <td className="tabular">—</td>
        <td className="tabular">—</td>
        <td className="tabular">{formatProbability(baseline.home_always_accuracy)}</td>
        <td className="tabular">—</td>
      </tr>
    </>
  );
}
