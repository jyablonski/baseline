import { cn } from "@/lib/utils";

const TONE = {
  better: { stroke: "stroke-primary", fill: "fill-primary" },
  worse: { stroke: "stroke-destructive", fill: "fill-destructive" },
  neutral: { stroke: "stroke-ink-2", fill: "fill-ink-2" },
} as const;

/**
 * Each game as a line, oldest to newest, over a dashed reference (the baseline
 * average). Gaps (a game with no value) are skipped. Decorative: the numbers it
 * draws are always printed beside it, so it is hidden from screen readers.
 */
export function Sparkline({
  values,
  reference,
  tone = "neutral",
  width = 120,
  height = 32,
  className,
}: {
  values: (number | null)[];
  reference?: number | null;
  tone?: keyof typeof TONE;
  width?: number;
  height?: number;
  className?: string;
}) {
  const points = values
    .map((value, index) => ({ value, index }))
    .filter((point): point is { value: number; index: number } => point.value != null);
  if (points.length < 2) return null;

  const all = points.map((point) => point.value);
  if (reference != null) all.push(reference);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = 3;
  const x = (index: number) => pad + (index / Math.max(values.length - 1, 1)) * (width - 2 * pad);
  // A flat line sits in the middle rather than on the floor.
  const y = (value: number) =>
    max === min ? height / 2 : pad + (1 - (value - min) / (max - min)) * (height - 2 * pad);
  const last = points[points.length - 1];

  return (
    <svg
      data-slot="sparkline"
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("block overflow-visible", className)}
    >
      {reference != null ? (
        <line
          x1={pad}
          x2={width - pad}
          y1={y(reference)}
          y2={y(reference)}
          className="stroke-ink-3"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ) : null}
      <polyline
        fill="none"
        className={TONE[tone].stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        points={points.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")}
      />
      <circle
        cx={x(last.index)}
        cy={y(last.value)}
        r={2.5}
        className={cn("stroke-0", TONE[tone].fill)}
      />
    </svg>
  );
}
