/**
 * Server-only client for /api/v1/admin.
 *
 * ADMIN_API_TOKEN is deliberately NOT a NEXT_PUBLIC_ variable: this module is
 * imported by server components only, so the token stays on the server and the
 * browser never receives credentials for the admin API. Do not import this
 * from a "use client" file.
 */

export type PipelineGate = {
  enabled: boolean;
  season_active: boolean;
  season_start: string | null;
  season_end: string | null;
  scrape_mode: string | null;
  target_season: string | null;
  last_success_at: string | null;
  last_scrape_date: string | null;
  reason: string | null;
  updated_at: string | null;
  action_today: string;
  reddit_would_run: boolean;
  hours_since_success: number | null;
  is_stale: boolean;
};

export type SourceHealth = {
  source_name: string;
  run_id: number | null;
  status: string;
  expectation: string;
  rows_written: number | null;
  attempt: number;
  error_type: string | null;
  error_detail: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_success_at: string | null;
  /** Most recent attempted runs in a row that failed or returned below expectation. */
  unhealthy_streak: number;
};

export type TableFreshness = {
  table_name: string;
  scraped_at: string | null;
  row_count: number;
};

export type GoldTable = { table_name: string; row_count: number };

export type DbtStatus = {
  last_dbt_exit: number | null;
  /** Null when the last build passed; empty when it failed before naming a node. */
  last_dbt_failed_nodes: string[] | null;
  last_dbt_run_at: string | null;
  last_dbt_run_id: number | null;
  gold_tables: GoldTable[];
  gold_table_count: number;
};

export type ModelStatus = {
  model_name: string;
  model_version: string;
  prediction_count: number;
  latest_as_of: string | null;
  latest_scraped_at: string | null;
  with_market_wp: number;
};

export type PipelineRun = {
  run_id: number;
  triggered_by: string;
  status: string;
  scrape_action: string | null;
  scrape_exit: number | null;
  reddit_ran: boolean | null;
  reddit_exit: number | null;
  dbt_exit: number | null;
  dbt_failed_nodes: string[] | null;
  ml_exit: number | null;
  detail: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
};

export const JOB_TYPES = ["scrape", "dbt", "ml", "refresh"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export function isJobType(value: unknown): value is JobType {
  return typeof value === "string" && (JOB_TYPES as readonly string[]).includes(value);
}

export type AdminJob = {
  job_id: number;
  job_type: string;
  status: string;
  requested_by: string;
  exit_code: number | null;
  detail: string | null;
  log_tail: string | null;
  requested_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

/** Host-wide numbers from the VM itself, not any one container. */
export type HostStats = {
  mem_total_bytes: number | null;
  mem_available_bytes: number | null;
  swap_total_bytes: number | null;
  swap_free_bytes: number | null;
  load_1m: number | null;
  load_5m: number | null;
  load_15m: number | null;
  cpu_count: number | null;
  uptime_seconds: number | null;
  disk_total_bytes: number | null;
  disk_used_bytes: number | null;
};

export type ContainerStats = {
  name: string;
  service: string | null;
  /** A `compose run` container (scraper/dbt/ml mid-refresh), not a long-lived service. */
  oneoff: boolean;
  status: string | null;
  health: string | null;
  exit_code: number | null;
  oom_killed: boolean;
  restart_count: number;
  started_at: string | null;
  mem_used_bytes: number | null;
  mem_limit_bytes: number | null;
  cpu_percent: number | null;
  pids: number | null;
};

export type ServiceConnections = {
  service: string;
  ports: number[];
  established: number;
  distinct_peers: number;
  top_peers: { address: string; connections: number }[];
};

export type HostSnapshot = {
  captured_at: string;
  host: HostStats | null;
  containers: ContainerStats[];
  connections: ServiceConnections[];
  errors: string[];
};

export type DbConnectionGroup = {
  user_name: string | null;
  application_name: string;
  client_addr: string | null;
  /** Outside loopback / private ranges, i.e. not another container. */
  is_external: boolean;
  state: string;
  connections: number;
  oldest_connected_at: string | null;
  longest_active_seconds: number | null;
};

export type DatabaseDiagnostics = {
  max_connections: number;
  total_connections: number;
  database_size_bytes: number;
  connections: DbConnectionGroup[];
};

export type Diagnostics = {
  /** Null until the host runner has recorded its first snapshot. */
  snapshot: HostSnapshot | null;
  database: DatabaseDiagnostics;
};

export type AdminHealth = {
  pipeline: PipelineGate;
  sources: SourceHealth[];
  freshness: TableFreshness[];
  dbt: DbtStatus;
  ml: ModelStatus[];
  recent_runs: PipelineRun[];
  recent_runs_total: number;
  jobs: AdminJob[];
  diagnostics: Diagnostics;
};

export class AdminApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

/**
 * Prefer the in-cluster URL: the admin page runs server-side inside Compose,
 * so it can reach the API directly instead of looping back out through Caddy
 * and the public hostname.
 */
function adminApiBase(): string {
  return (
    process.env.ADMIN_API_URL ||
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000"
  );
}

export async function fetchAdminHealth(
  runs: { limit: number; offset: number } | null = null
): Promise<AdminHealth> {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    throw new AdminApiError("ADMIN_API_TOKEN is not set, so the admin API cannot be reached.", 503);
  }

  const query = runs
    ? `?${new URLSearchParams({ run_limit: String(runs.limit), run_offset: String(runs.offset) })}`
    : "";
  const response = await fetch(`${adminApiBase()}/api/v1/admin/health${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    // Operational data is worthless cached; always read through.
    cache: "no-store",
  });

  if (!response.ok) {
    throw new AdminApiError(
      `Admin API returned ${response.status} ${response.statusText}`,
      response.status
    );
  }

  const body = (await response.json()) as { data: AdminHealth };
  return body.data;
}

/**
 * Queue a job for the host runner. Returns 202 on success and 409 when one is
 * already queued or running, which the console surfaces rather than retrying.
 */
export async function enqueueAdminJob(jobType: JobType, requestedBy: string): Promise<AdminJob> {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    throw new AdminApiError("ADMIN_API_TOKEN is not set.", 503);
  }

  const response = await fetch(`${adminApiBase()}/api/v1/admin/jobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ job_type: jobType, requested_by: requestedBy }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: string }) => body.detail)
      .catch(() => undefined);
    throw new AdminApiError(
      detail ?? `Admin API returned ${response.status} ${response.statusText}`,
      response.status
    );
  }

  const body = (await response.json()) as { data: AdminJob };
  return body.data;
}
