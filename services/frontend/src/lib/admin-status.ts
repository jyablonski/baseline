import type {
  AdminHealth,
  ContainerStats,
  DatabaseDiagnostics,
  DbtStatus,
  Diagnostics,
  HostSnapshot,
  ModelStatus,
  SourceHealth,
} from "@/lib/admin";

/** Traffic-light level shared by every panel on the admin page. */
export type Level = "ok" | "warn" | "bad" | "idle";

export const LEVEL_BADGE: Record<Level, "default" | "secondary" | "destructive" | "outline"> = {
  ok: "default",
  warn: "secondary",
  bad: "destructive",
  idle: "outline",
};

export const LEVEL_LABEL: Record<Level, string> = {
  ok: "Healthy",
  warn: "Degraded",
  bad: "Needs attention",
  idle: "Idle",
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

export const RUNS_PAGE_SIZE = 5;

/** `?runs=` is 1-based and user-editable, so anything odd falls back to page 1. */
export function parseRunsPage(value: string | string[] | undefined): number {
  const page = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function worstOf(levels: Level[]): Level {
  if (levels.includes("bad")) return "bad";
  if (levels.includes("warn")) return "warn";
  if (levels.length > 0 && levels.every((level) => level === "idle")) return "idle";
  return "ok";
}

function ratio(part: number | null, whole: number | null): number | null {
  return part === null || whole === null || whole <= 0 ? null : part / whole;
}

/** Near-limit memory, an OOM kill, or a service that is not running. */
export function containerLevel(container: ContainerStats): Level {
  if (container.oom_killed || container.health === "unhealthy") return "bad";
  if (container.status !== "running") return container.oneoff ? "idle" : "bad";
  const used = ratio(container.mem_used_bytes, container.mem_limit_bytes);
  if (used !== null && used >= 0.9) return "bad";
  if ((used !== null && used >= 0.75) || container.restart_count > 0) return "warn";
  return "ok";
}

/** Past this the collector has stopped (cron, python3, or Docker), not the VM. */
export const SNAPSHOT_STALE_MINUTES = 5;

export function isSnapshotStale(snapshot: HostSnapshot, now = Date.now()): boolean {
  const minutes = (now - new Date(snapshot.captured_at).getTime()) / 60_000;
  return !Number.isFinite(minutes) || minutes > SNAPSHOT_STALE_MINUTES;
}

export function snapshotLevel(snapshot: HostSnapshot | null, now = Date.now()): Level {
  if (snapshot === null) return "idle";
  if (isSnapshotStale(snapshot, now)) return "warn";
  const levels: Level[] = snapshot.containers.map(containerLevel);
  if (snapshot.errors.length > 0) levels.push("warn");
  const host = snapshot.host;
  if (host) {
    // MemAvailable counts reclaimable page cache, so this is real headroom.
    const available = ratio(host.mem_available_bytes, host.mem_total_bytes);
    if (available !== null) levels.push(available < 0.1 ? "bad" : available < 0.2 ? "warn" : "ok");
    const swapFree = ratio(host.swap_free_bytes, host.swap_total_bytes);
    if (swapFree !== null && swapFree < 0.5) levels.push("warn");
    const disk = ratio(host.disk_used_bytes, host.disk_total_bytes);
    if (disk !== null) levels.push(disk >= 0.9 ? "bad" : disk >= 0.8 ? "warn" : "ok");
    if (host.load_5m !== null && host.cpu_count && host.load_5m > host.cpu_count) {
      levels.push("warn");
    }
  }
  return worstOf(levels);
}

/** Queries running over this long are worth a look on a box this size. */
export const LONG_QUERY_SECONDS = 300;

/**
 * Pool exhaustion or a stuck query. External clients are shown, not scored:
 * DBeaver over the public IP is expected, and only the operator can tell it
 * apart from someone else holding the password.
 */
export function databaseLevel(database: DatabaseDiagnostics): Level {
  const used = ratio(database.total_connections, database.max_connections) ?? 0;
  if (used >= 0.95) return "bad";
  const stuck = database.connections.some(
    (group) => (group.longest_active_seconds ?? 0) > LONG_QUERY_SECONDS
  );
  return used >= 0.8 || stuck ? "warn" : "ok";
}

export function vmLevel(diagnostics: Diagnostics, now = Date.now()): Level {
  const snapshot = snapshotLevel(diagnostics.snapshot, now);
  const database = databaseLevel(diagnostics.database);
  // No snapshot yet reads as idle, but must not hide a database problem.
  if (snapshot === "idle") return database === "ok" ? "idle" : database;
  return worstOf([snapshot, database]);
}

export function overallLevel(health: AdminHealth): Level {
  const levels = [
    pipelineLevel(health),
    dbtLevel(health.dbt),
    mlLevel(health.ml),
    vmLevel(health.diagnostics),
  ];
  return worstOf(levels);
}

export function formatAge(iso: string | null): string {
  if (!iso) return "never";
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (!Number.isFinite(hours)) return "unknown";
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled >= 10 || unit === 0 ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`;
}

export function formatPercent(part: number | null, whole: number | null): string {
  const value = ratio(part, whole);
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US");
}
