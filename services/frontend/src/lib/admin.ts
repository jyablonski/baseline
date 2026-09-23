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

export type AdminHealth = {
  pipeline: PipelineGate;
  sources: SourceHealth[];
  freshness: TableFreshness[];
  dbt: DbtStatus;
  ml: ModelStatus[];
  recent_runs: PipelineRun[];
  jobs: AdminJob[];
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

export async function fetchAdminHealth(): Promise<AdminHealth> {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    throw new AdminApiError("ADMIN_API_TOKEN is not set, so the admin API cannot be reached.", 503);
  }

  const response = await fetch(`${adminApiBase()}/api/v1/admin/health`, {
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
