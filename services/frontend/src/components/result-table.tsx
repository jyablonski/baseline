import {
  askDisplayRows,
  askTableColumns,
  askTableLabel,
  formatAskCell,
  isAskNumericColumn,
} from "@/lib/ask-table";
import { cn } from "@/lib/utils";

/**
 * The rows behind an Ask or Chat answer. Renders nothing when there are no
 * displayable columns.
 */
export function ResultTable({
  rows,
  limit,
  alignNumbers = false,
}: {
  rows: Record<string, unknown>[];
  /** Show only the first rows; the caller offers the rest. */
  limit?: number;
  /** Right-align numeric columns and their headings. */
  alignNumbers?: boolean;
}) {
  const display = askDisplayRows(rows);
  const columns = askTableColumns(display);
  if (columns.length === 0) return null;
  const shown = limit == null ? display : display.slice(0, limit);
  const right = (column: string) => alignNumbers && isAskNumericColumn(column) && "text-right";

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} className={cn(right(column)) || undefined}>
                {askTableLabel(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td
                  key={column}
                  className={
                    cn(isAskNumericColumn(column) && "tabular", right(column)) || undefined
                  }
                >
                  {formatAskCell(row[column], column)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
