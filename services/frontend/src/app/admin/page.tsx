import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminTable } from "@/components/admin/admin-table";
import { AdminApiError, fetchAdminHealth } from "@/lib/admin";
import {
  LEVEL_BADGE,
  LEVEL_LABEL,
  RUNS_PAGE_SIZE,
  dbtLevel,
  formatAge,
  formatBytes,
  formatCount,
  formatPercent,
  mlLevel,
  overallLevel,
  parseRunsPage,
  pipelineLevel,
  sourceLevel,
  vmLevel,
} from "@/lib/admin-status";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { JobButtons } from "@/components/admin/job-buttons";
import { DbtBuildStatus } from "@/components/admin/dbt-build-status";
import { RunsPager } from "@/components/admin/runs-pager";
import { VmDiagnostics } from "@/components/admin/vm-diagnostics";
import { auth } from "@/auth";
import { adminJobsEnabled, isAllowedLogin } from "@/lib/admin-access";
import { redirect } from "next/navigation";

// Operational data: never statically rendered, never cached.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ runs?: string | string[] }>;
}) {
  // Defence in depth: middleware already gates this route, but a page that
  // renders operational data should not depend on one matcher regex being
  // right. Cheap to re-check, expensive to get wrong.
  const session = await auth();
  if (!isAllowedLogin(session?.user?.login)) {
    redirect("/admin/signin");
  }

  const runsPage = parseRunsPage((await searchParams).runs);

  let health;
  try {
    health = await fetchAdminHealth({
      limit: RUNS_PAGE_SIZE,
      offset: (runsPage - 1) * RUNS_PAGE_SIZE,
    });
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
  const {
    pipeline,
    dbt,
    ml,
    sources,
    freshness,
    recent_runs: runs,
    recent_runs_total: runsTotal,
    jobs,
    diagnostics,
  } = health;
  const host = diagnostics.snapshot?.host ?? null;
  const memUsed =
    host?.mem_total_bytes != null && host.mem_available_bytes != null
      ? host.mem_total_bytes - host.mem_available_bytes
      : null;
  const hasPendingJob = jobs.some((job) => job.status === "queued" || job.status === "running");

  return (
    <article className="space-y-6">
      <AdminHeader />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>System status</CardTitle>
          <Badge variant={LEVEL_BADGE[overall]}>{LEVEL_LABEL[overall]}</Badge>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <Metric
            label="VM"
            level={vmLevel(diagnostics)}
            value={
              host
                ? `${formatPercent(memUsed, host.mem_total_bytes)} memory used`
                : "no host snapshot"
            }
            hint={`${diagnostics.database.total_connections} db connections${
              diagnostics.snapshot ? ` · ${formatAge(diagnostics.snapshot.captured_at)}` : ""
            }${host ? ` · ${formatBytes(memUsed)} of ${formatBytes(host.mem_total_bytes)}` : ""}`}
          />
        </CardContent>
      </Card>

      <VmDiagnostics diagnostics={diagnostics} />

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <JobButtons hasPendingJob={hasPendingJob} enabled={adminJobsEnabled()} />
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
                  <TableHead className="text-right">Streak</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <TableRow key={source.source_name}>
                    <TableCell className="font-medium">{source.source_name}</TableCell>
                    <TableCell>
                      <Badge variant={LEVEL_BADGE[sourceLevel(source)]}>
                        {source.status === "success" && source.expectation === "below"
                          ? "no rows"
                          : source.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(source.rows_written)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {source.unhealthy_streak > 0 ? source.unhealthy_streak : "—"}
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
            <CardTitle>dbt build</CardTitle>
          </CardHeader>
          <CardContent>
            <DbtBuildStatus dbt={dbt} />
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
        <CardContent className="space-y-4">
          {runs.length === 0 ? (
            <Empty>
              {runsTotal === 0 ? "No pipeline runs recorded." : "No runs on this page."}
            </Empty>
          ) : (
            <AdminTable>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Run</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">dbt</TableHead>
                  <TableHead className="text-right">ml</TableHead>
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
                    <TableCell className="text-right tabular-nums">
                      {run.ml_exit === null ? "—" : run.ml_exit}
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
          {runsTotal > RUNS_PAGE_SIZE ? (
            <RunsPager page={runsPage} pageSize={RUNS_PAGE_SIZE} total={runsTotal} />
          ) : null}
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
