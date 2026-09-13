import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminTable } from "@/components/admin/admin-table";
import { AdminApiError, fetchAdminHealth } from "@/lib/admin";
import {
  LEVEL_BADGE,
  dbtLevel,
  formatAge,
  formatCount,
  mlLevel,
  overallLevel,
  pipelineLevel,
  sourceLevel,
} from "@/lib/admin-status";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { JobButtons } from "@/components/admin/job-buttons";
import { auth } from "@/auth";
import { isAllowedLogin } from "@/lib/admin-access";
import { redirect } from "next/navigation";

// Operational data: never statically rendered, never cached.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { title: "Admin" };

const LEVEL_LABEL = {
  ok: "Healthy",
  warn: "Degraded",
  bad: "Needs attention",
  idle: "Idle",
} as const;

export default async function AdminPage() {
  // Defence in depth: middleware already gates this route, but a page that
  // renders operational data should not depend on one matcher regex being
  // right. Cheap to re-check, expensive to get wrong.
  const session = await auth();
  if (!isAllowedLogin(session?.user?.login)) {
    redirect("/admin/signin");
  }

  let health;
  try {
    health = await fetchAdminHealth();
  } catch (error) {
    const message =
      error instanceof AdminApiError ? error.message : "Could not reach the admin API.";
    return (
      <article className="space-y-6">
        <AdminHeader />
        <Card>
          <CardHeader>
            <CardTitle>Admin API unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{message}</p>
            <p>
              Check that the API is running and that <code>ADMIN_API_TOKEN</code> matches on both
              the API and the frontend.
            </p>
          </CardContent>
        </Card>
      </article>
    );
  }

  const overall = overallLevel(health);
  const { pipeline, dbt, ml, sources, freshness, recent_runs: runs, jobs } = health;
  const hasPendingJob = jobs.some((job) => job.status === "queued" || job.status === "running");

  return (
    <article className="space-y-6">
      <AdminHeader />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>System status</CardTitle>
          <Badge variant={LEVEL_BADGE[overall]}>{LEVEL_LABEL[overall]}</Badge>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Metric
            label="Ingestion"
            level={pipelineLevel(health)}
            value={pipeline.enabled ? pipeline.action_today : "disabled"}
            hint={`last success ${formatAge(pipeline.last_success_at)}`}
          />
          <Metric
            label="dbt"
            level={dbtLevel(dbt)}
            value={
              dbt.last_dbt_exit === null
                ? "no run recorded"
                : `exit ${dbt.last_dbt_exit}${
                    dbt.last_dbt_run_id === null ? "" : ` · run #${dbt.last_dbt_run_id}`
                  }`
            }
            hint={`${dbt.gold_table_count} gold tables · ${formatAge(dbt.last_dbt_run_at)}`}
          />
          <Metric
            label="ML"
            level={mlLevel(ml)}
            value={ml.length === 0 ? "no predictions" : `${ml.length} model(s)`}
            hint={
              ml.length === 0
                ? "nothing scored yet"
                : `latest ${formatAge(
                    ml
                      .map((model) => model.latest_scraped_at)
                      .sort()
                      .at(-1) ?? null
                  )}`
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <JobButtons hasPendingJob={hasPendingJob} />
          {jobs.length > 0 ? (
            <AdminTable>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Job</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Exit</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Requested</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.job_id}>
                    <TableCell className="text-right tabular-nums">{job.job_id}</TableCell>
                    <TableCell className="font-medium">{job.job_type}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          job.status === "succeeded"
                            ? "default"
                            : job.status === "failed"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {job.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {job.exit_code === null ? "—" : job.exit_code}
                    </TableCell>
                    <TableCell>{job.requested_by}</TableCell>
                    <TableCell>{formatAge(job.requested_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </AdminTable>
          ) : null}
          {jobs.find((job) => job.status === "failed")?.log_tail ? (
            <pre className="max-h-48 overflow-auto bg-muted/40 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
              {jobs.find((job) => job.status === "failed")?.log_tail}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ingestion gate</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Enabled" value={pipeline.enabled ? "yes" : "no"} />
          <Field label="Season active" value={pipeline.season_active ? "yes" : "no"} />
          <Field label="Scrape mode" value={pipeline.scrape_mode ?? "—"} />
          <Field label="Action today" value={pipeline.action_today} />
          <Field label="Reddit would run" value={pipeline.reddit_would_run ? "yes" : "no"} />
          <Field label="Last success" value={formatAge(pipeline.last_success_at)} />
          <Field label="Last scrape date" value={pipeline.last_scrape_date ?? "—"} />
          <Field label="Target season" value={pipeline.target_season ?? "—"} />
          {pipeline.reason ? (
            <p className="text-muted-foreground sm:col-span-2 lg:col-span-4">{pipeline.reason}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sources</CardTitle>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <Empty>No per-source runs recorded yet. They appear after the next scrape.</Empty>
          ) : (
            <AdminTable>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Since success</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <TableRow key={source.source_name}>
                    <TableCell className="font-medium">{source.source_name}</TableCell>
                    <TableCell>
                      <Badge variant={LEVEL_BADGE[sourceLevel(source)]}>{source.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(source.rows_written)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {source.runs_since_success > 0 ? source.runs_since_success : "—"}
                    </TableCell>
                    <TableCell>{formatAge(source.started_at)}</TableCell>
                    <TableCell className="max-w-[24rem] truncate text-muted-foreground">
                      {source.error_detail ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </AdminTable>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Source freshness</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminTable>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>Scraped</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {freshness.map((table) => (
                  <TableRow key={table.table_name}>
                    <TableCell className="font-medium">{table.table_name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(table.row_count)}
                    </TableCell>
                    <TableCell>{formatAge(table.scraped_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </AdminTable>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>dbt marts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              The exit code above comes from the last <em>pipeline</em> run. A standalone{" "}
              <code>make dbt</code> does not record one, so it will not clear a stale failure — the
              mart row counts below are the live signal.
            </p>
            {dbt.gold_tables.length === 0 ? (
              <Empty>No gold tables yet — dbt has not built successfully here.</Empty>
            ) : (
              <AdminTable>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mart</TableHead>
                    <TableHead className="text-right">Rows (approx)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dbt.gold_tables.map((table) => (
                    <TableRow key={table.table_name}>
                      <TableCell className="font-medium">{table.table_name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(table.row_count)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </AdminTable>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ML predictions</CardTitle>
        </CardHeader>
        <CardContent>
          {ml.length === 0 ? (
            <Empty>No rows in source.game_predictions yet.</Empty>
          ) : (
            <AdminTable>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead className="text-right">Predictions</TableHead>
                  <TableHead className="text-right">With market WP</TableHead>
                  <TableHead>Latest</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ml.map((model) => (
                  <TableRow key={`${model.model_name}-${model.model_version}`}>
                    <TableCell className="font-medium">{model.model_name}</TableCell>
                    <TableCell>{model.model_version}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(model.prediction_count)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(model.with_market_wp)}
                    </TableCell>
                    <TableCell>{formatAge(model.latest_scraped_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </AdminTable>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <Empty>No pipeline runs recorded.</Empty>
          ) : (
            <AdminTable>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Run</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">dbt</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.run_id}>
                    <TableCell className="text-right tabular-nums">{run.run_id}</TableCell>
                    <TableCell>{run.triggered_by}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          run.status === "success"
                            ? "default"
                            : run.status === "failed"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{run.scrape_action ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.dbt_exit === null ? "—" : run.dbt_exit}
                    </TableCell>
                    <TableCell>{formatAge(run.started_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.duration_seconds === null ? "—" : `${Math.round(run.duration_seconds)}s`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </AdminTable>
          )}
        </CardContent>
      </Card>
    </article>
  );
}

function AdminHeader() {
  return (
    <header className="flex items-center justify-between gap-4">
      <div>
        <h1 className="type-page">Admin</h1>
        <p className="text-sm text-muted-foreground">Ingestion, dbt, and ML health. Read-only.</p>
      </div>
      <SignOutButton />
    </header>
  );
}

function Metric({
  label,
  level,
  value,
  hint,
}: {
  label: string;
  level: keyof typeof LEVEL_BADGE;
  value: string;
  hint: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Badge variant={LEVEL_BADGE[level]}>{LEVEL_LABEL[level]}</Badge>
      </div>
      <p className="text-sm text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
