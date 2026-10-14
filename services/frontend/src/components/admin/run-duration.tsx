import type { PipelineRun } from "@/lib/admin";
import { formatAge, isInstantRun } from "@/lib/admin-status";
import { cn } from "@/lib/utils";

/** One bar per run, oldest on the left, scaled to the longest of them. */
export function RunDuration({ runs }: { runs: PipelineRun[] }) {
  const timed = runs.filter((run) => run.duration_seconds !== null).reverse();
  if (timed.length === 0) {
    return <p className="text-sm text-muted-foreground">No finished runs to chart yet.</p>;
  }
  const longest = Math.max(...timed.map((run) => run.duration_seconds ?? 0), 1);

  return (
    <ol className="flex gap-3">
      {timed.map((run) => {
        const seconds = run.duration_seconds ?? 0;
        const odd = isInstantRun(run);
        const failed = run.status === "failed";
        return (
          <li key={run.run_id} className="min-w-0 flex-1 text-center">
            <div className="flex h-32 flex-col justify-end border-b border-rule-strong">
              <span
                className={cn(
                  "pb-1 font-mono text-xs",
                  failed ? "text-destructive" : odd ? "text-warn" : "text-ink-2"
                )}
              >
                {Math.round(seconds)}s
              </span>
              <div
                data-testid={`run-bar-${run.run_id}`}
                className={cn(
                  "min-h-[3px]",
                  failed ? "bg-loss-bar" : odd ? "bg-warn" : "bg-accent-soft"
                )}
                style={{ height: `${(seconds / longest) * 80}%` }}
              />
            </div>
            <p className="type-caption mt-2 truncate">
              #{run.run_id} · {formatAge(run.started_at)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
