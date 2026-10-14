import type { Metadata } from "next";
import Link from "next/link";

import { KpiCard, KpiStrip } from "@/components/ui/kpi-card";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminTable } from "@/components/admin/admin-table";
import {
  AdminApiError,
  fetchAdminFlags,
  fetchAdminHealth,
  type AdminHealth,
  type FeatureFlag,
  type PipelineRun,
} from "@/lib/admin";
import {
  RUNS_PAGE_SIZE,
  SOURCE_TABLES,
  adminTabHref,
  dbtLevel,
  formatAge,
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
  latestPredictionAt,
  mlLevel,
  overallLevel,
  parseAdminTab,
  parseRunsPage,
  pipelineLevel,
  reviewItems,
  reviewSummary,
  sourceCounts,
  sourceLevel,
  type ReviewItem,
} from "@/lib/admin-status";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { JobButtons } from "@/components/admin/job-buttons";
import { FeatureFlags } from "@/components/admin/feature-flags";
import { DbtBuildStatus } from "@/components/admin/dbt-build-status";
import { RunDuration } from "@/components/admin/run-duration";
import { RunsPager } from "@/components/admin/runs-pager";
import { Section } from "@/components/admin/section";
import { Status, StatusDot } from "@/components/admin/status";
import { VmDiagnostics } from "@/components/admin/vm-diagnostics";
import { auth } from "@/auth";
import { adminJobsEnabled, isAdminUser } from "@/lib/admin-access";
import { redirect } from "next/navigation";

// Operational data: never statically rendered, never cached.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; runs?: string | string[] }>;
}) {
  // Defence in depth: middleware already gates this route, but a page that
  // renders operational data should not depend on one matcher regex being
  // right. Cheap to re-check, expensive to get wrong.
  const session = await auth();
  if (!isAdminUser(session?.user)) {
    redirect("/admin/signin");
  }

  const params = await searchParams;
  const tab = parseAdminTab(params.tab);
  const runsPage = tab === "pipeline" ? parseRunsPage(params.runs) : 1;

  let health;
  // Null when an older page of runs could not be read: only that table suffers.
  let pagedRuns: PipelineRun[] | null;
  try {
    // Always the newest runs: the header, the review list, and the overview
    // describe the latest state whichever page of the runs table is open.
    const [latest, older] = await Promise.all([
      fetchAdminHealth({ limit: RUNS_PAGE_SIZE, offset: 0 }),
      runsPage === 1
        ? null
        : fetchAdminHealth({
            limit: RUNS_PAGE_SIZE,
            offset: (runsPage - 1) * RUNS_PAGE_SIZE,
          }).then(
            (page) => page.recent_runs,
            () => null
          ),
    ]);
    health = latest;
    pagedRuns = runsPage === 1 ? latest.recent_runs : older;
  } catch (error) {
    const message =
      error instanceof AdminApiError ? error.message : "Could not reach the admin API.";
    return (
      <article className="space-y-6">
        <h1 className="type-page">Admin</h1>
        <section className="space-y-2 border-t border-rule-strong pt-4 text-sm text-muted-foreground">
          <h2 className="type-module text-foreground">Admin API unavailable</h2>
          <p>{message}</p>
          <p>
            Check that the API is running and that <code>ADMIN_API_TOKEN</code> matches on both the
            API and the frontend.
          </p>
        </section>
      </article>
    );
  }

  const overall = overallLevel(health);
  const items = reviewItems(health);
  const snapshot = health.diagnostics.snapshot;

  return (
    <article>
      <header className="mb-8 space-y-3">
        <h1 className="type-page">Admin</h1>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="flex items-baseline gap-3">
            <Status level={overall} className="items-baseline gap-3 font-semibold" />
            <span className="text-ink-2">{reviewSummary(items)}</span>
          </p>
          <p className="type-timestamp normal-case">
            {snapshot ? `Snapshot ${formatAge(snapshot.captured_at)}` : "No host snapshot"}
          </p>
        </div>
      </header>

      <AdminTabs active={tab} items={items} />

      {tab === "overview" ? <Overview health={health} items={items} /> : null}
      {tab === "pipeline" ? (
        <Pipeline health={health} runs={pagedRuns} runsPage={runsPage} />
      ) : null}
      {tab === "infrastructure" ? <VmDiagnostics diagnostics={health.diagnostics} /> : null}
      {tab === "settings" ? <Settings /> : null}
    </article>
  );
}

function Overview({ health, items }: { health: AdminHealth; items: ReviewItem[] }) {
  const { pipeline, dbt, ml, sources, recent_runs: runs, diagnostics } = health;
  // The headline is the last successful scrape, so label it with the run that was one.
  const latestRun = runs.find((run) => run.status === "success") ?? runs.at(0);
  const counts = sourceCounts(sources);
  const host = diagnostics.snapshot?.host ?? null;
  const memUsed =
    host?.mem_total_bytes != null && host.mem_available_bytes != null
      ? host.mem_total_bytes - host.mem_available_bytes
      : null;
  const versions = ml.map((model) => model.model_version);

  return (
    <div className="space-y-10">
      <KpiStrip className="border-x border-t-0 border-rule border-b-rule">
        <KpiCard
          label="Last refresh"
          value={formatAge(pipeline.last_success_at)}
          note={
            latestRun
              ? `run #${latestRun.run_id}${
                  latestRun.duration_seconds === null
                    ? ""
                    : ` · ${Math.round(latestRun.duration_seconds)}s`
                }`
              : "no runs recorded"
          }
        />
        <KpiCard
          label="Sources"
          value={counts.total === 0 ? "—" : `${counts.succeeded} of ${counts.total}`}
          note={
            counts.total === 0
              ? "no source runs recorded"
              : [
                  counts.failed > 0 ? `${counts.failed} failed or empty` : null,
                  counts.skipped > 0 ? `${counts.skipped} skipped` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "all succeeded"
          }
        />
        <KpiCard
          label="dbt + ML"
          value={`${dbt.gold_table_count} tables`}
          note={
            ml.length === 0
              ? "no predictions yet"
              : `${ml.length} models · predictions ${formatAge(latestPredictionAt(ml))}`
          }
        />
        <KpiCard
          label="VM memory"
          value={host ? formatPercent(memUsed, host.mem_total_bytes) : "—"}
          progress={
            host?.mem_total_bytes && memUsed !== null ? memUsed / host.mem_total_bytes : undefined
          }
          note={
            host
              ? `${formatBytes(memUsed)} of ${formatBytes(host.mem_total_bytes)} · disk ${formatPercent(
                  host.disk_used_bytes,
                  host.disk_total_bytes
                )} · up ${formatDuration(host.uptime_seconds)}`
              : "no host snapshot"
          }
        />
      </KpiStrip>

      <div className="grid gap-x-14 gap-y-10 lg:grid-cols-2">
        <Section
          title="Needs review"
          note={`${items.length} ${items.length === 1 ? "item" : "items"}`}
        >
          {items.length === 0 ? (
            <Empty>Nothing needs a look right now.</Empty>
          ) : (
            <ul className="divide-y divide-rule border-b border-rule">
              {items.map((item) => (
                <li key={item.key} className="flex items-baseline gap-4 py-4">
                  <StatusDot level={item.level} className="translate-y-[-1px]" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">{item.title}</p>
                    <p className="text-ink-2">{item.detail}</p>
                  </div>
                  <Link
                    href={adminTabHref(item.tab)}
                    className="text-sm whitespace-nowrap text-primary hover:underline"
                  >
                    {item.tab === "pipeline" ? "Pipeline" : "Infrastructure"} →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="space-y-10">
          <Section title={latestRun ? `Last refresh · run #${latestRun.run_id}` : "Last refresh"}>
            <dl className="divide-y divide-rule border-b border-rule">
              <StageRow
                label="Ingestion"
                level={pipelineLevel(health)}
                value={
                  !pipeline.enabled
                    ? "disabled"
                    : counts.total === 0
                      ? "no source runs recorded"
                      : [
                          `${counts.succeeded} succeeded`,
                          counts.failed > 0 ? `${counts.failed} failed or empty` : null,
                          counts.skipped > 0 ? `${counts.skipped} skipped` : null,
                        ]
                          .filter(Boolean)
                          .join(", ")
                }
              />
              <StageRow
                label="dbt"
                level={dbtLevel(dbt)}
                value={
                  dbt.last_dbt_exit === null
                    ? "no run recorded"
                    : `exit ${dbt.last_dbt_exit} · ${dbt.gold_table_count} gold tables`
                }
              />
              <StageRow
                label="ML"
                level={mlLevel(ml)}
                value={
                  versions.length === 0
                    ? "no predictions"
                    : `${versions.join(", ")} · ${formatAge(latestPredictionAt(ml))}`
                }
              />
            </dl>
          </Section>

          <Section
            title="Run duration"
            note={runs.length > 1 ? `last ${runs.length} runs` : undefined}
          >
            <RunDuration runs={runs} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Pipeline({
  health,
  runs,
  runsPage,
}: {
  health: AdminHealth;
  runs: PipelineRun[] | null;
  runsPage: number;
}) {
  const { pipeline, dbt, ml, sources, freshness, recent_runs_total: runsTotal, jobs } = health;
  const hasPendingJob = jobs.some((job) => job.status === "queued" || job.status === "running");
  const failedJobLog = jobs.find((job) => job.status === "failed")?.log_tail;
  const tables = new Map(freshness.map((table) => [table.table_name, table]));
  const shown = new Set(sources.flatMap((source) => SOURCE_TABLES[source.source_name] ?? []));
  const otherTables = freshness.filter((table) => !shown.has(table.table_name));

  return (
    <div className="space-y-10">
      <div>
        <div className="space-y-4 border-b border-rule-strong py-6">
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
                  <TableHead className="text-right">Requested</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.job_id}>
                    <TableCell className="text-right">{job.job_id}</TableCell>
                    <TableCell className="font-mono">{job.job_type}</TableCell>
                    <TableCell>
                      <Status level={outcomeLevel(job.status, "succeeded")}>{job.status}</Status>
                    </TableCell>
                    <TableCell className="text-right">
                      {job.exit_code === null ? "—" : job.exit_code}
                    </TableCell>
                    <TableCell>{job.requested_by}</TableCell>
                    <TableCell className="text-right text-ink-2">
                      {formatAge(job.requested_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </AdminTable>
          ) : null}
          {failedJobLog ? (
            <pre className="max-h-48 overflow-auto bg-tint p-3 text-xs whitespace-pre-wrap text-muted-foreground">
              {failedJobLog}
            </pre>
          ) : null}
        </div>

        <dl className="grid gap-x-6 gap-y-5 border-b border-rule py-6 sm:grid-cols-4 lg:grid-cols-7">
          <Field label="Enabled" value={pipeline.enabled ? "yes" : "no"} />
          <Field label="Season active" value={pipeline.season_active ? "yes" : "no"} />
          <Field label="Scrape mode" value={pipeline.scrape_mode ?? "—"} />
          <Field label="Action today" value={pipeline.action_today} />
          <Field label="Reddit would run" value={pipeline.reddit_would_run ? "yes" : "no"} />
          <Field label="Last success" value={formatAge(pipeline.last_success_at)} />
          <Field label="Last scrape date" value={pipeline.last_scrape_date ?? "—"} />
          <Field
            label="Target season"
            value={pipeline.target_season ?? "not set"}
            flagged={pipeline.target_season === null}
          />
          {pipeline.reason ? (
            <p className="text-ink-2 sm:col-span-4 lg:col-span-7">{pipeline.reason}</p>
          ) : null}
        </dl>
      </div>

      <Section title="Sources">
        {sources.length === 0 ? (
          <Empty>No per-source runs recorded yet. They appear after the next scrape.</Empty>
        ) : (
          <AdminTable>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead>Writes to (total rows)</TableHead>
                <TableHead className="text-right">Scraped</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((source) => {
                const level = sourceLevel(source);
                const written = (SOURCE_TABLES[source.source_name] ?? [])
                  .map((name) => tables.get(name))
                  .filter((table) => table !== undefined);
                return (
                  <TableRow key={source.source_name}>
                    <TableCell className="font-mono">{source.source_name}</TableCell>
                    <TableCell>
                      <Status level={level}>
                        {source.status === "success" && source.expectation === "below"
                          ? "no rows"
                          : source.status}
                        {source.unhealthy_streak > 1 ? ` ×${source.unhealthy_streak}` : ""}
                      </Status>
                      {source.error_detail ? (
                        <p
                          className="type-caption max-w-[24rem] truncate"
                          title={source.error_detail}
                        >
                          {source.error_detail}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {level === "idle" ? "—" : formatCount(source.rows_written)}
                    </TableCell>
                    <TableCell className="text-ink-2">
                      {written.length === 0
                        ? "—"
                        : written
                            .map((table) => `${table.table_name} ${formatCount(table.row_count)}`)
                            .join(" · ")}
                    </TableCell>
                    <TableCell className="text-right text-ink-2">
                      {formatAge(source.last_success_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </AdminTable>
        )}
        {otherTables.length > 0 ? (
          <p className="type-caption">
            Tables with no source run above:{" "}
            {otherTables
              .map(
                (table) =>
                  `${table.table_name} ${formatCount(table.row_count)} (${formatAge(table.scraped_at)})`
              )
              .join(" · ")}
          </p>
        ) : null}
      </Section>

      <div className="grid gap-x-14 gap-y-10 lg:grid-cols-2">
        <Section title="dbt build">
          <DbtBuildStatus dbt={dbt} />
        </Section>

        <Section title="ML predictions">
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
                  <TableHead className="text-right">Latest</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ml.map((model) => (
                  <TableRow key={`${model.model_name}-${model.model_version}`}>
                    <TableCell className="font-mono">{model.model_name}</TableCell>
                    <TableCell>{model.model_version}</TableCell>
                    <TableCell className="text-right">
                      {formatCount(model.prediction_count)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCount(model.with_market_wp)}
                    </TableCell>
                    <TableCell className="text-right text-ink-2">
                      {formatAge(model.latest_scraped_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </AdminTable>
          )}
        </Section>
      </div>

      <Section title="Recent runs">
        {runs === null ? (
          <Empty>Could not load this page of runs.</Empty>
        ) : runs.length === 0 ? (
          <Empty>{runsTotal === 0 ? "No pipeline runs recorded." : "No runs on this page."}</Empty>
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
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.run_id}>
                  <TableCell className="text-right">{run.run_id}</TableCell>
                  <TableCell>{run.triggered_by}</TableCell>
                  <TableCell>
                    <Status level={outcomeLevel(run.status, "success")}>{run.status}</Status>
                  </TableCell>
                  <TableCell>{run.scrape_action ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {run.dbt_exit === null ? "—" : run.dbt_exit}
                  </TableCell>
                  <TableCell className="text-right">
                    {run.ml_exit === null ? "—" : run.ml_exit}
                  </TableCell>
                  <TableCell className="text-right">
                    {run.duration_seconds === null ? "—" : `${Math.round(run.duration_seconds)}s`}
                  </TableCell>
                  <TableCell className="text-right text-ink-2">
                    {formatAge(run.started_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </AdminTable>
        )}
        {runsTotal > RUNS_PAGE_SIZE ? (
          <RunsPager page={runsPage} pageSize={RUNS_PAGE_SIZE} total={runsTotal} />
        ) : null}
      </Section>
    </div>
  );
}

async function Settings() {
  // Its own request so a flags failure cannot take the health view down with it.
  let flags: FeatureFlag[] | null = null;
  try {
    flags = await fetchAdminFlags();
  } catch {
    flags = null;
  }

  return (
    <div className="pt-10">
      <Section title="Feature flags">
        {flags === null ? (
          <Empty>Could not load the feature flags.</Empty>
        ) : (
          <FeatureFlags flags={flags} />
        )}
      </Section>
    </div>
  );
}

/** A job or run row: its success word is ok, "failed" is bad, anything else is in flight. */
function outcomeLevel(status: string, success: string) {
  return status === success ? "ok" : status === "failed" ? "bad" : "idle";
}

function StageRow({
  label,
  level,
  value,
}: {
  label: string;
  level: Parameters<typeof Status>[0]["level"];
  value: string;
}) {
  return (
    <div className="grid grid-cols-[6rem_1fr_auto] items-baseline gap-4 py-3">
      <dt className="font-semibold">{label}</dt>
      <dd className="text-ink-2">{value}</dd>
      <dd className="text-sm">
        <Status level={level} />
      </dd>
    </div>
  );
}

function Field({ label, value, flagged }: { label: string; value: string; flagged?: boolean }) {
  return (
    <div>
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className={flagged ? "mt-1 text-warn" : "mt-1"}>{value}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
