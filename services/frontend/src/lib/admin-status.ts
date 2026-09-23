import type { AdminHealth, DbtStatus, ModelStatus, SourceHealth } from "@/lib/admin";

/** Traffic-light level shared by every panel on the admin page. */
export type Level = "ok" | "warn" | "bad" | "idle";

export const LEVEL_BADGE: Record<Level, "default" | "secondary" | "destructive" | "outline"> = {
  ok: "default",
  warn: "secondary",
  bad: "destructive",
  idle: "outline",
};

/** A source is only "bad" once it has missed more than once; one miss is noise. */
export function sourceLevel(source: SourceHealth): Level {
  if (source.status === "skipped") return "idle";
  if (source.status === "failed" || source.expectation === "below") {
    return source.unhealthy_streak > 1 ? "bad" : "warn";
  }
  return "ok";
}

export function pipelineLevel(health: AdminHealth): Level {
  if (!health.pipeline.enabled) return "idle";
  if (health.pipeline.is_stale) return "bad";
  const worst = health.sources.map(sourceLevel);
  if (worst.includes("bad")) return "bad";
  if (worst.includes("warn")) return "warn";
  return "ok";
}

export function dbtLevel(dbt: DbtStatus): Level {
  if (dbt.last_dbt_exit === null) return "idle";
  if (dbt.last_dbt_exit !== 0) return "bad";
  // dbt reported success but produced no marts: worth surfacing, not an error.
  return dbt.gold_table_count === 0 ? "warn" : "ok";
}

export function mlLevel(models: ModelStatus[], staleAfterHours = 26): Level {
  if (models.length === 0) return "idle";
  const latest = models
    .map((model) => model.latest_scraped_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  if (!latest) return "idle";
  const hours = (Date.now() - new Date(latest).getTime()) / 3_600_000;
  return hours > staleAfterHours ? "warn" : "ok";
}

export function overallLevel(health: AdminHealth): Level {
  const levels = [pipelineLevel(health), dbtLevel(health.dbt), mlLevel(health.ml)];
  if (levels.includes("bad")) return "bad";
  if (levels.includes("warn")) return "warn";
  if (levels.every((level) => level === "idle")) return "idle";
  return "ok";
}

export function formatAge(iso: string | null): string {
  if (!iso) return "never";
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (!Number.isFinite(hours)) return "unknown";
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US");
}
