import { LEVEL_LABEL, type Level } from "@/lib/admin-status";
import { cn } from "@/lib/utils";

const DOT: Record<Level, string> = {
  ok: "bg-primary",
  warn: "bg-warn",
  bad: "bg-destructive",
  idle: "bg-ink-3",
};

export const LEVEL_TEXT: Record<Level, string> = {
  ok: "text-primary",
  warn: "text-warn",
  bad: "text-destructive",
  idle: "text-ink-3",
};

export function StatusDot({ level, className }: { level: Level; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-level={level}
      className={cn("inline-block size-2 shrink-0 rounded-full", DOT[level], className)}
    />
  );
}

/** A dot and a word, coloured by level. The word defaults to the level's own label. */
export function Status({
  level,
  children,
  className,
}: {
  level: Level;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", LEVEL_TEXT[level], className)}>
      <StatusDot level={level} />
      {children ?? LEVEL_LABEL[level]}
    </span>
  );
}

/** A thin share-of-whole bar. `value` is 0 to 1; anything else is clamped. */
export function Meter({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-[3px] bg-rule", className)}
    >
      <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}
