import { formatMonth, formatMonthShort, shiftMonth } from "@/lib/calendar";

/** A calendar's month title with ← / → buttons, bounded by `months`. */
export function MonthNav({
  month,
  months,
  onChange,
}: {
  month: string;
  months: string[];
  onChange: (month: string) => void;
}) {
  const index = months.indexOf(month);
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="type-module" aria-live="polite">
        {formatMonth(month)}
      </h3>
      <div className="flex border border-foreground" role="group" aria-label="Month">
        <button
          type="button"
          aria-label="Previous month"
          className="seg-btn normal-case hover:text-foreground disabled:opacity-40"
          disabled={index <= 0}
          onClick={() => onChange(shiftMonth(month, -1))}
        >
          ← {formatMonthShort(shiftMonth(month, -1))}
        </button>
        <button
          type="button"
          aria-label="Next month"
          className="seg-btn border-l border-foreground normal-case hover:text-foreground disabled:opacity-40"
          disabled={index === -1 || index >= months.length - 1}
          onClick={() => onChange(shiftMonth(month, 1))}
        >
          {formatMonthShort(shiftMonth(month, 1))} →
        </button>
      </div>
    </div>
  );
}
