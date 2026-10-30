import type {
  AdminHealth,
  ContainerStats,
  DatabaseDiagnostics,
  DbtStatus,
  Diagnostics,
  HostSnapshot,
  HostStats,
  ModelStatus,
  PipelineGate,
  PipelineRun,
  SourceHealth,
} from "@/lib/admin";

/** Traffic-light level shared by every panel on the admin page. */
export type Level = "ok" | "warn" | "bad" | "idle";

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

/** When the newest prediction of any model was scored. */
export function latestPredictionAt(models: ModelStatus[]): string | null {
  return (
    models
      .map((model) => model.latest_scraped_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
  );
}

export function mlLevel(models: ModelStatus[], staleAfterHours = 26): Level {
  const latest = latestPredictionAt(models);
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

/** One scored reading per host resource, so the level and the review list agree. */
export function hostChecks(host: HostStats): { resource: string; level: Level; detail: string }[] {
  const checks: { resource: string; level: Level; detail: string }[] = [];
  // MemAvailable counts reclaimable page cache, so this is real headroom.
  const available = ratio(host.mem_available_bytes, host.mem_total_bytes);
  if (available !== null) {
    checks.push({
      resource: "Memory",
      level: available < 0.1 ? "bad" : available < 0.2 ? "warn" : "ok",
      detail: `${Math.round(available * 100)}% of memory is still available.`,
    });
  }
  const swapFree = ratio(host.swap_free_bytes, host.swap_total_bytes);
  if (swapFree !== null) {
    checks.push({
      resource: "Swap",
      level: swapFree < 0.5 ? "warn" : "ok",
      detail: `${Math.round((1 - swapFree) * 100)}% of swap is in use.`,
    });
  }
  const disk = ratio(host.disk_used_bytes, host.disk_total_bytes);
  if (disk !== null) {
    checks.push({
      resource: "Disk",
      level: disk >= 0.9 ? "bad" : disk >= 0.8 ? "warn" : "ok",
      detail: `${Math.round(disk * 100)}% of the disk is used.`,
    });
  }
  if (host.load_5m !== null && host.cpu_count) {
    checks.push({
      resource: "Load",
      level: host.load_5m > host.cpu_count ? "warn" : "ok",
      detail: `5-minute load is ${host.load_5m.toFixed(2)} on ${host.cpu_count} CPUs.`,
    });
  }
  return checks;
}

export function snapshotLevel(snapshot: HostSnapshot | null, now = Date.now()): Level {
  if (snapshot === null) return "idle";
  if (isSnapshotStale(snapshot, now)) return "warn";
  const levels: Level[] = snapshot.containers.map(containerLevel);
  if (snapshot.errors.length > 0) levels.push("warn");
  if (snapshot.host) levels.push(...hostChecks(snapshot.host).map((check) => check.level));
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

export const ADMIN_TABS = ["overview", "pipeline", "models", "infrastructure", "settings"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

/** `?tab=` is user-editable, so anything unknown falls back to the overview. */
export function parseAdminTab(value: string | string[] | undefined): AdminTab {
  const tab = Array.isArray(value) ? value[0] : value;
  return (ADMIN_TABS as readonly string[]).includes(tab ?? "") ? (tab as AdminTab) : "overview";
}

export function adminTabHref(tab: AdminTab): string {
  return tab === "overview" ? "/admin" : `/admin?tab=${tab}`;
}

/** How the last run of each source went, for the overview headline. */
export function sourceCounts(sources: SourceHealth[]) {
  const levels = sources.map(sourceLevel);
  const skipped = levels.filter((level) => level === "idle").length;
  const succeeded = levels.filter((level) => level === "ok").length;
  return {
    total: sources.length,
    succeeded,
    skipped,
    failed: sources.length - succeeded - skipped,
  };
}

/**
 * Sources whose latest healthy row came from the hourly catch-up. It records a
 * source only when it landed rows, so these are the daily's gaps, since filled.
 */
export function recoveredSources(sources: SourceHealth[]): SourceHealth[] {
  return sources.filter(
    (source) => source.run_triggered_by === "catch-up" && sourceLevel(source) === "ok"
  );
}

/** "recovered by catch-up #74", or by "catch-up #73 and #74" when it took two. */
export function recoveryNote(sources: SourceHealth[]): string | null {
  const runs = [...new Set(sources.flatMap((source) => source.run_id ?? []))].sort((a, b) => a - b);
  if (runs.length === 0) return null;
  return `recovered by catch-up ${joinNames(runs.map((run) => `#${run}`))}`;
}

/**
 * Which `source` tables each scraper source fills. The API reports the two
 * separately (per-source runs, per-table watermarks) and has no join between
 * them; a source that is not listed here simply shows no tables.
 */
export const SOURCE_TABLES: Record<string, string[]> = {
  todays_games: ["games"],
  player_game_logs: ["player_game_logs"],
  play_by_play: ["play_by_play"],
  standings: ["standings"],
  injuries: ["player_injuries"],
  contracts: ["player_contracts", "team_payroll"],
  odds: ["game_odds"],
  reddit: ["reddit_posts", "reddit_comments"],
};

/**
 * Something for the operator to look at. `bad` is blocking; `warn` is worth a
 * look; `idle` is expected but would otherwise read as broken. Kept apart from
 * the traffic-light levels: an odd-looking run does not make the system
 * unhealthy, so several of these never move the overall status.
 */
export type ReviewItem = {
  key: string;
  level: "bad" | "warn" | "idle";
  title: string;
  detail: string;
  tab: "pipeline" | "models" | "infrastructure";
};

function pipelineReviewItems(health: AdminHealth): ReviewItem[] {
  const { pipeline, sources, dbt, ml, recent_runs: runs } = health;
  const items: ReviewItem[] = [];
  const add = (item: Omit<ReviewItem, "tab">) => items.push({ ...item, tab: "pipeline" });

  if (pipeline.enabled && pipeline.is_stale) {
    add({
      key: "stale",
      level: "bad",
      title: "Ingestion is stale",
      detail: `The last successful scrape was ${formatAge(pipeline.last_success_at)}.`,
    });
  }
  if (pipeline.enabled && needsTargetSeason(pipeline) && pipeline.target_season === null) {
    add({
      key: "target-season",
      level: "warn",
      title: "Target season is empty",
      detail: "Scrape mode is season but no target season is set, so the NBA scrape does nothing.",
    });
  }

  for (const source of sources) {
    const level = sourceLevel(source);
    if (level !== "bad" && level !== "warn") continue;
    const streak = source.unhealthy_streak > 1 ? ` ${source.unhealthy_streak} runs in a row` : "";
    add({
      key: `source-${source.source_name}`,
      level,
      title:
        source.status === "failed"
          ? `${source.source_name} failed${streak}`
          : `${source.source_name} returned no rows${streak}`,
      detail: source.error_detail ?? `Last healthy run ${formatAge(source.last_success_at)}.`,
    });
  }

  if (dbt.last_dbt_exit !== null && dbt.last_dbt_exit !== 0) {
    const failed = dbt.last_dbt_failed_nodes?.length ?? 0;
    add({
      key: "dbt-failed",
      level: "bad",
      title: `dbt build failed with exit ${dbt.last_dbt_exit}`,
      detail:
        failed === 0
          ? "dbt stopped before naming a failing model or test."
          : `${failed} ${failed === 1 ? "node" : "nodes"} failed; downstream models were skipped.`,
    });
  } else if (dbtLevel(dbt) === "warn") {
    add({
      key: "dbt-empty",
      level: "warn",
      title: "dbt built no gold tables",
      detail: "The last build exited 0 but the gold schema is empty.",
    });
  }

  if (mlLevel(ml) === "warn") {
    add({
      key: "ml-stale",
      level: "warn",
      title: "ML predictions are stale",
      detail: `The newest prediction was scored ${formatAge(latestPredictionAt(ml))}.`,
    });
  }

  // One manual run is an operator pressing a button; nothing but manual runs
  // suggests the scheduled refresh is not the one doing the work.
  if (runs.length > 1 && runs.every((run) => run.triggered_by === "manual")) {
    const ids = runs.map((run) => run.run_id);
    add({
      key: "manual-runs",
      level: "warn",
      title: "Every recent run is a manual trigger",
      detail: `Runs #${Math.min(...ids)}–${Math.max(...ids)} are labelled manual. The refresh cron entry needs TRIGGER=scheduled to be recorded as scheduled.`,
    });
  }
  for (const run of runs.filter(isInstantRun)) {
    add({
      key: `instant-run-${run.run_id}`,
      level: "warn",
      title: `Run #${run.run_id} finished in 0s`,
      detail: "Likely a no-op. Worth a look if it was meant to scrape or rebuild models.",
    });
  }

  const never = sources.filter(
    (source) =>
      source.status === "skipped" &&
      source.last_success_at === null &&
      !GAME_SOURCES.has(source.source_name)
  );
  if (never.length > 0) {
    add({
      key: "never-scraped",
      level: "idle",
      title: `${joinNames(never.map((source) => source.source_name))} never scraped`,
      detail: "Skipped on every run so far, so nothing has been collected yet.",
    });
  }
  return items;
}

/** Only season mode reads target_season; daily mode always scrapes the current season. */
export function needsTargetSeason(pipeline: PipelineGate): boolean {
  return pipeline.scrape_mode?.toLowerCase() === "season";
}

// The daily scrape only attempts these once a game has gone final, so before
// the first game of the season "never scraped" is the expected state.
const GAME_SOURCES = new Set(["player_game_logs", "play_by_play"]);

const NBA_ACTION_LABELS: Record<string, string> = {
  daily: "Daily",
  season: "Season backfill",
  skipped_disabled: "Disabled",
  skipped_offseason: "Off-season",
  skipped_mode_none: "Nothing to scrape",
  noop: "Nothing to scrape",
  dbt: "dbt only",
  "catch-up": "Catch-up",
};

/**
 * What a run did, named by its NBA scrape. Contracts, transactions, and Reddit
 * ride along on every enabled run, so spelling them out only adds noise; the
 * Sources table has how each did, and the raw string stays as a tooltip.
 */
export function runActionLabel(action: string | null): string {
  if (!action) return "—";
  const parts = action.split("+");
  const nba = parts.find((part) => part in NBA_ACTION_LABELS);
  if (nba) return NBA_ACTION_LABELS[nba];
  // The scraper leaves the NBA action out when it was gated off but the
  // ungated sources still ran, which is the off-season on an enabled gate.
  if (parts.every((part) => ["contracts", "transactions", "reddit"].includes(part))) {
    return "Off-season";
  }
  return action;
}

/** A run that reported success without taking any time did no work. */
export function isInstantRun(run: PipelineRun): boolean {
  return run.status === "success" && run.duration_seconds !== null && run.duration_seconds < 1;
}

function joinNames(names: string[]): string {
  return names.length < 3
    ? names.join(" and ")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function infrastructureReviewItems(diagnostics: Diagnostics, now: number): ReviewItem[] {
  const { snapshot, database } = diagnostics;
  const items: ReviewItem[] = [];
  const add = (item: Omit<ReviewItem, "tab">) => items.push({ ...item, tab: "infrastructure" });

  if (snapshot !== null && isSnapshotStale(snapshot, now)) {
    add({
      key: "snapshot-stale",
      level: "warn",
      title: "Host snapshot is stale",
      detail: `Last recorded ${formatAge(snapshot.captured_at)}. The admin-jobs cron, python3, or Docker on the host has stopped reporting.`,
    });
  } else if (snapshot !== null) {
    for (const check of snapshot.host ? hostChecks(snapshot.host) : []) {
      if (check.level !== "bad" && check.level !== "warn") continue;
      add({
        key: `host-${check.resource}`,
        level: check.level,
        title: `${check.resource} is under pressure`,
        detail: check.detail,
      });
    }
    for (const container of snapshot.containers) {
      const level = containerLevel(container);
      if (level !== "bad" && level !== "warn") continue;
      add({
        key: `container-${container.name}`,
        level,
        title: `${container.service ?? container.name} needs a look`,
        detail: container.oom_killed
          ? "The container was OOM killed."
          : container.status !== "running"
            ? `The container is ${container.status ?? "in an unknown state"}.`
            : container.health === "unhealthy"
              ? "Its health check is failing."
              : `${formatPercent(container.mem_used_bytes, container.mem_limit_bytes)} of its memory limit used, ${container.restart_count} restarts.`,
      });
    }
    if (snapshot.errors.length > 0) {
      add({
        key: "snapshot-errors",
        level: "warn",
        title: "The host snapshot is incomplete",
        detail: snapshot.errors.join("; "),
      });
    }
  }

  const level = databaseLevel(database);
  if (level === "bad" || level === "warn") {
    const stuck = database.connections.some(
      (group) => (group.longest_active_seconds ?? 0) > LONG_QUERY_SECONDS
    );
    add({
      key: "database",
      level,
      title: stuck
        ? "A Postgres query has been running a long time"
        : "Postgres is near its connection limit",
      detail: `${database.total_connections} of ${database.max_connections} connections in use.`,
    });
  }
  return items;
}

/** Blocking items first, then the ones worth a look, then the merely notable. */
export function reviewItems(
  health: AdminHealth,
  modelItems: ReviewItem[] = [],
  now = Date.now()
): ReviewItem[] {
  const order = { bad: 0, warn: 1, idle: 2 };
  return [
    ...pipelineReviewItems(health),
    ...modelItems,
    ...infrastructureReviewItems(health.diagnostics, now),
  ].sort((a, b) => order[a.level] - order[b.level]);
}

export function reviewSummary(items: ReviewItem[]): string {
  if (items.length === 0) return "Nothing to review";
  const blocking = items.filter((item) => item.level === "bad").length;
  return `${items.length} ${items.length === 1 ? "item" : "items"} to review, ${
    blocking === 0 ? "none" : blocking
  } blocking`;
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
