import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const signIn = vi.hoisted(() => vi.fn());
const actionState = vi.hoisted(() => ({
  current: null as { ok: boolean; message: string } | null,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/auth", () => ({ signIn }));
vi.mock("@/app/admin/actions", () => ({
  promoteModelAction: vi.fn(),
  remindModelAction: vi.fn(),
  requestJobAction: vi.fn(),
  setFlagAction: vi.fn(),
  setPipelineAction: vi.fn(),
}));
// The form is never submitted here, so the real hook would always report a
// resting state; stubbing it lets both result branches render.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useActionState: () => [actionState.current, vi.fn(), false] };
});

import { AdminTable } from "@/components/admin/admin-table";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { DbtBuildStatus, DBT_FAILED_NODES_CAP } from "@/components/admin/dbt-build-status";
import { SignInButtons } from "@/components/account/sign-in-buttons";
import { FeatureFlags } from "@/components/admin/feature-flags";
import { JobButtons } from "@/components/admin/job-buttons";
import { ModelsPanel } from "@/components/admin/models-panel";
import { PipelineSwitches } from "@/components/admin/pipeline-switches";
import { RunDuration } from "@/components/admin/run-duration";
import { RunsPager } from "@/components/admin/runs-pager";
import { Section } from "@/components/admin/section";
import { Meter, Status, StatusDot } from "@/components/admin/status";
import { VmDiagnostics } from "@/components/admin/vm-diagnostics";
import type { DbtStatus, Diagnostics, PipelineGate, PipelineRun } from "@/lib/admin";
import type { ReviewItem } from "@/lib/admin-status";
import { buildModelReview } from "@/lib/model-review";

const JOB_LABELS = ["Re-run ingestion", "Re-run dbt", "Re-run ML", "Full refresh"];

describe("JobButtons", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    actionState.current = null;
  });

  it("offers one enabled button per job type when nothing is running", () => {
    render(<JobButtons hasPendingJob={false} enabled />);
    for (const label of JOB_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }
    expect(screen.getByText("Run now")).toBeInTheDocument();
    expect(screen.getByText(/One job at a time/)).toBeInTheDocument();
  });

  it("disables every button while a job is queued or running", () => {
    render(<JobButtons hasPendingJob enabled />);
    for (const label of JOB_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    expect(screen.getByText(/This page refreshes itself until it finishes/)).toBeInTheDocument();
  });

  it("disables every button and skips polling when jobs are disabled", () => {
    vi.useFakeTimers();
    render(<JobButtons hasPendingJob enabled={false} />);
    for (const label of JOB_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    expect(screen.getByText(/only production runs queued jobs/)).toBeInTheDocument();
    vi.advanceTimersByTime(30_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("submits the job type as the button value", () => {
    render(<JobButtons hasPendingJob={false} enabled />);
    const button = screen.getByRole("button", { name: "Re-run dbt" });
    // The server action reads this field, so the name/value pair is the contract.
    expect(button).toHaveAttribute("name", "job_type");
    expect(button).toHaveAttribute("value", "dbt");
  });

  it("polls for a fresh page only while a job is pending", () => {
    vi.useFakeTimers();
    const { unmount, rerender } = render(<JobButtons hasPendingJob enabled />);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(refresh).toHaveBeenCalledTimes(3);

    // Once the job finishes the page must stop refreshing itself.
    rerender(<JobButtons hasPendingJob={false} enabled />);
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("clears its interval on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<JobButtons hasPendingJob enabled />);
    unmount();
    vi.advanceTimersByTime(30_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a queued job and flags a failure differently", () => {
    actionState.current = { ok: true, message: "Queued dbt as job #12." };
    const { unmount } = render(<JobButtons hasPendingJob={false} enabled />);
    expect(screen.getByText("Queued dbt as job #12.")).not.toHaveClass("text-destructive");
    unmount();

    actionState.current = { ok: false, message: "A job is already running." };
    render(<JobButtons hasPendingJob={false} enabled />);
    expect(screen.getByText("A job is already running.")).toHaveClass("text-destructive");
  });
});

describe("AdminTable", () => {
  it("adds column padding and keeps the caller's own classes", () => {
    // The shared primitives ship with px-0, so without this every admin table
    // renders its columns flush against each other.
    const { container } = render(
      <AdminTable className="mt-4">
        <tbody>
          <tr>
            <td>cell</td>
          </tr>
        </tbody>
      </AdminTable>
    );
    const table = container.querySelector("table") as HTMLElement;
    expect(table.className).toContain("[&_td]:px-3");
    expect(table.className).toContain("mt-4");
    expect(within(table).getByText("cell")).toBeInTheDocument();
  });
});

describe("SignInButtons", () => {
  it("starts the chosen provider's sign-in and returns to the given page", async () => {
    render(<SignInButtons redirectTo="/picks" />);
    const github = screen.getByRole("button", { name: "Sign in with GitHub" });
    const google = screen.getByRole("button", { name: "Sign in with Google" });
    fireEvent.submit(google.closest("form") as HTMLFormElement);
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/picks" }));
    fireEvent.submit(github.closest("form") as HTMLFormElement);
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("github", { redirectTo: "/picks" }));
  });
});

describe("DbtBuildStatus", () => {
  const base: DbtStatus = {
    last_dbt_exit: 0,
    last_dbt_failed_nodes: null,
    last_dbt_run_at: new Date().toISOString(),
    last_dbt_run_id: 22,
    gold_tables: [],
    gold_table_count: 20,
  };

  it("says only that the last build passed when it did", () => {
    render(<DbtBuildStatus dbt={base} />);
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.getByText(/Last build passed · run #22/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("names the failed nodes", () => {
    render(
      <DbtBuildStatus
        dbt={{
          ...base,
          last_dbt_exit: 1,
          last_dbt_failed_nodes: ["model fct_x", "test not_null_fct_x_id"],
        }}
      />
    );
    expect(screen.getByText("Failed · exit 1")).toBeInTheDocument();
    expect(screen.getByText(/2 nodes failed/)).toBeInTheDocument();
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "model fct_x",
      "test not_null_fct_x_id",
    ]);
  });

  it("uses the singular for one failure and tolerates a missing run id", () => {
    render(
      <DbtBuildStatus
        dbt={{
          ...base,
          last_dbt_exit: 1,
          last_dbt_run_id: null,
          last_dbt_failed_nodes: ["model fct_x"],
        }}
      />
    );
    expect(screen.getByText(/1 node failed/)).toBeInTheDocument();
    expect(screen.queryByText(/run #/)).not.toBeInTheDocument();
  });

  it("says when the list is truncated", () => {
    const nodes = Array.from({ length: DBT_FAILED_NODES_CAP }, (_, i) => `test t${i}`);
    render(<DbtBuildStatus dbt={{ ...base, last_dbt_exit: 1, last_dbt_failed_nodes: nodes }} />);
    expect(screen.getByText(/First 25 failures/)).toBeInTheDocument();
  });

  it("explains a failure with nothing to name, and a build that never ran", () => {
    const { unmount } = render(
      <DbtBuildStatus dbt={{ ...base, last_dbt_exit: 2, last_dbt_failed_nodes: [] }} />
    );
    expect(screen.getByText(/stopped before naming/)).toBeInTheDocument();
    unmount();
    render(<DbtBuildStatus dbt={{ ...base, last_dbt_exit: null }} />);
    expect(screen.getByText("No dbt build recorded yet.")).toBeInTheDocument();
  });
});

describe("RunsPager", () => {
  it("links to older runs from the first page and disables Newer", () => {
    render(<RunsPager page={1} pageSize={5} total={22} />);
    expect(screen.getByText("1–5 of 22")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Older" })).toHaveAttribute(
      "href",
      "/admin?tab=pipeline&runs=2"
    );
    expect(screen.queryByRole("link", { name: "Newer" })).not.toBeInTheDocument();
    expect(screen.getByText("Newer")).toHaveAttribute("aria-disabled", "true");
  });

  it("shows an empty range when there are no runs", () => {
    render(<RunsPager page={1} pageSize={5} total={0} />);
    expect(screen.getByText("0–0 of 0")).toBeInTheDocument();
  });

  it("returns to the bare URL for page one and stops at the last page", () => {
    render(<RunsPager page={2} pageSize={5} total={10} />);
    expect(screen.getByText("6–10 of 10")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Newer" })).toHaveAttribute(
      "href",
      "/admin?tab=pipeline"
    );
    expect(screen.getByText("Older")).toHaveAttribute("aria-disabled", "true");
  });
});

describe("VmDiagnostics", () => {
  const MB = 1024 * 1024;
  const diagnostics: Diagnostics = {
    snapshot: {
      captured_at: new Date().toISOString(),
      host: {
        mem_total_bytes: 24_000 * MB,
        mem_available_bytes: 19_000 * MB,
        swap_total_bytes: 0,
        swap_free_bytes: 0,
        load_1m: 0.01,
        load_5m: 0.02,
        load_15m: 0.05,
        cpu_count: 4,
        uptime_seconds: 86_400,
        disk_total_bytes: 100_000 * MB,
        disk_used_bytes: 30_000 * MB,
      },
      containers: [
        {
          name: "nba-postgres-1",
          service: "postgres",
          oneoff: false,
          status: "running",
          health: "healthy",
          exit_code: 0,
          oom_killed: false,
          restart_count: 0,
          started_at: new Date().toISOString(),
          mem_used_bytes: 291 * MB,
          mem_limit_bytes: 2048 * MB,
          cpu_percent: 0,
          pids: 11,
        },
      ],
      connections: [
        {
          service: "caddy",
          ports: [80, 443],
          established: 3,
          distinct_peers: 2,
          top_peers: [
            { address: "203.0.113.9", connections: 2 },
            { address: "198.51.100.4", connections: 1 },
          ],
        },
      ],
      errors: [],
    },
    database: {
      max_connections: 100,
      total_connections: 6,
      database_size_bytes: 900 * MB,
      connections: [
        {
          user_name: "postgres",
          application_name: "DBeaver",
          client_addr: "203.0.113.9",
          is_external: true,
          state: "idle",
          connections: 2,
          oldest_connected_at: null,
          longest_active_seconds: null,
        },
      ],
    },
  };

  it("renders host, container, connection, and database health", () => {
    render(<VmDiagnostics diagnostics={diagnostics} />);
    expect(screen.getByText("4.9 GB of 23 GB · page cache excluded")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Memory" })).toHaveAttribute(
      "aria-valuenow",
      "21"
    );
    expect(screen.getByRole("progressbar", { name: "Disk" })).toHaveAttribute(
      "aria-valuenow",
      "30"
    );
    expect(screen.getByText("no swap")).toBeInTheDocument();
    expect(screen.getByText("0.02 / 0.05 on 4 CPUs (1 / 5 / 15m)")).toBeInTheDocument();
    expect(screen.getByText("1 running · 0 restarts")).toBeInTheDocument();
    expect(screen.getByText("291 MB / 2.0 GB · 14%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "postgres memory" })).toBeInTheDocument();
    // A plainly running container gets a dot, not a status word.
    expect(screen.queryByText("running")).not.toBeInTheDocument();
    expect(screen.getByText("Site (Caddy)")).toBeInTheDocument();
    expect(screen.getByText("3 open · 2 clients")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.9 ×2, 198.51.100.4 ×1")).toBeInTheDocument();
    expect(screen.getByText("6 of 100 connections · 900 MB")).toBeInTheDocument();
    expect(screen.getByText("external")).toBeInTheDocument();
    const external = screen.getByText("External connections").closest("li") as HTMLElement;
    expect(within(external).getByText("2")).toBeInTheDocument();
  });

  it("renders unhappy and sparse states without crashing", () => {
    const snapshot = diagnostics.snapshot!;
    const base = snapshot.containers[0];
    render(
      <VmDiagnostics
        diagnostics={{
          snapshot: {
            ...snapshot,
            host: {
              ...snapshot.host!,
              mem_available_bytes: null,
              swap_total_bytes: 4_000 * MB,
              swap_free_bytes: 1_000 * MB,
              load_1m: null,
              cpu_count: null,
            },
            containers: [
              { ...base, name: "nba-api-1", service: "api", oom_killed: true },
              {
                ...base,
                name: "nba-frontend-1",
                service: "frontend",
                status: "exited",
                exit_code: 137,
                health: null,
                mem_used_bytes: null,
                cpu_percent: null,
                pids: null,
              },
              { ...base, name: "nba-cube-1", service: null, health: "unhealthy" },
              { ...base, name: "nba-dbt-run-1", service: "dbt", oneoff: true },
            ],
            connections: [
              { service: "mcp", ports: [8000], established: 0, distinct_peers: 0, top_peers: [] },
              { service: "other", ports: [9000], established: 1, distinct_peers: 1, top_peers: [] },
            ],
            errors: ["connections: TimeoutExpired: docker exec"],
          },
          database: {
            ...diagnostics.database,
            connections: [
              {
                user_name: null,
                application_name: "psql",
                client_addr: null,
                is_external: false,
                state: "active",
                connections: 1,
                oldest_connected_at: null,
                longest_active_seconds: 900,
              },
            ],
          },
        }}
      />
    );
    // The stuck query is scored on the Postgres section itself.
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("OOM killed")).toHaveClass("text-destructive");
    expect(screen.getByText("exited (137)")).toBeInTheDocument();
    expect(screen.getByText("unhealthy")).toBeInTheDocument();
    expect(screen.getByText("nba-cube-1")).toBeInTheDocument();
    expect(screen.getByText("(job)")).toBeInTheDocument();
    expect(screen.getByText("MCP")).toBeInTheDocument();
    expect(screen.getByText("other")).toBeInTheDocument();
    expect(screen.getByText(/TimeoutExpired/)).toBeInTheDocument();
    expect(screen.getByText(/local socket/)).toBeInTheDocument();
    expect(screen.getByText("active · 15m")).toBeInTheDocument();
    expect(screen.getByText("2.9 GB")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("0.02 / 0.05 (1 / 5 / 15m)")).toBeInTheDocument();
    const external = screen.getByText("External connections").closest("li") as HTMLElement;
    expect(within(external).getByText("None")).toBeInTheDocument();
  });

  it("handles a snapshot with no host section and nothing running", () => {
    render(
      <VmDiagnostics
        diagnostics={{
          snapshot: { ...diagnostics.snapshot!, host: null, containers: [], connections: [] },
          database: { ...diagnostics.database, connections: [] },
        }}
      />
    );
    expect(screen.getByText("No containers reported.")).toBeInTheDocument();
    expect(screen.getByText(/No Caddy or MCP container/)).toBeInTheDocument();
    expect(screen.getByText("No other connections.")).toBeInTheDocument();
    expect(screen.queryByText("Memory")).not.toBeInTheDocument();
  });

  it("explains a missing or stale snapshot", () => {
    const { unmount } = render(<VmDiagnostics diagnostics={{ ...diagnostics, snapshot: null }} />);
    expect(screen.getByText(/No host snapshot yet/)).toBeInTheDocument();
    // Postgres is read live, so it still shows; the snapshot sections do not.
    expect(screen.getByText("Postgres")).toBeInTheDocument();
    expect(screen.queryByText("Inbound connections")).not.toBeInTheDocument();
    unmount();
    const stale = new Date(Date.now() - 30 * 60_000).toISOString();
    render(
      <VmDiagnostics
        diagnostics={{ ...diagnostics, snapshot: { ...diagnostics.snapshot!, captured_at: stale } }}
      />
    );
    expect(screen.getByText(/stale: the admin-jobs cron/)).toHaveClass("text-warn");
  });
});

describe("FeatureFlags", () => {
  afterEach(() => {
    actionState.current = null;
  });

  const flags = [
    {
      flag_key: "chatbot",
      enabled: true,
      description: "Signed-in chat at /chat.",
      updated_at: new Date().toISOString(),
      updated_by: "jyablonski",
    },
    {
      flag_key: "picks",
      enabled: false,
      description: "Signed-in game picks.",
      updated_at: new Date().toISOString(),
      updated_by: null,
    },
  ];

  it("lists each flag with its state and who last changed it", () => {
    render(<FeatureFlags flags={flags} />);
    const chatbot = screen.getByTestId("flag-chatbot");
    expect(within(chatbot).getByText("On")).toBeInTheDocument();
    expect(within(chatbot).getByText("Signed-in chat at /chat.")).toBeInTheDocument();
    expect(within(chatbot).getByText(/Last changed .* by jyablonski/)).toBeInTheDocument();
    const picks = screen.getByTestId("flag-picks");
    expect(within(picks).getByText("Off")).toBeInTheDocument();
    expect(within(picks).getByText("Never changed")).toBeInTheDocument();
  });

  it("submits the opposite of the current state for the flag that was clicked", () => {
    render(<FeatureFlags flags={flags} />);
    const chatbot = screen.getByTestId("flag-chatbot");
    expect(within(chatbot).getByRole("switch", { name: "chatbot" })).toBeChecked();
    // The server action reads these two fields; they are the contract.
    expect(chatbot.querySelector('input[name="flag_key"]')).toHaveValue("chatbot");
    expect(chatbot.querySelector('input[name="enabled"]')).toHaveValue("false");
    const picks = screen.getByTestId("flag-picks");
    expect(within(picks).getByRole("switch", { name: "picks" })).not.toBeChecked();
    expect(picks.querySelector('input[name="enabled"]')).toHaveValue("true");
  });

  it("shows the outcome of the last change", () => {
    actionState.current = { ok: true, message: "chatbot is now off." };
    const { rerender } = render(<FeatureFlags flags={flags} />);
    expect(screen.getByText("chatbot is now off.")).toBeInTheDocument();
    actionState.current = { ok: false, message: "Not authorised." };
    rerender(<FeatureFlags flags={flags} />);
    expect(screen.getByText("Not authorised.")).toHaveClass("text-destructive");
  });

  it("says so when no flags exist", () => {
    render(<FeatureFlags flags={[]} />);
    expect(screen.getByText("No feature flags are defined.")).toBeInTheDocument();
  });
});

describe("PipelineSwitches", () => {
  afterEach(() => {
    actionState.current = null;
  });

  const gate = (overrides: Partial<PipelineGate> = {}): PipelineGate => ({
    enabled: true,
    season_active: false,
    season_start: null,
    season_end: null,
    scrape_mode: "daily",
    target_season: null,
    last_success_at: null,
    last_scrape_date: null,
    reason: "Season turned off from /admin by jyablonski.",
    updated_at: new Date().toISOString(),
    action_today: "skipped_offseason",
    reddit_would_run: true,
    hours_since_success: 2,
    is_stale: false,
    ...overrides,
  });

  it("shows each switch and submits its opposite", () => {
    render(<PipelineSwitches pipeline={gate()} />);
    const enabled = screen.getByTestId("pipeline-enabled");
    expect(within(enabled).getByRole("switch", { name: "Pipeline" })).toBeChecked();
    // The server action reads these two fields; they are the contract.
    expect(enabled.querySelector('input[name="switch"]')).toHaveValue("enabled");
    expect(enabled.querySelector('input[name="value"]')).toHaveValue("false");
    const season = screen.getByTestId("pipeline-season_active");
    expect(within(season).getByText("Off")).toBeInTheDocument();
    expect(season.querySelector('input[name="value"]')).toHaveValue("true");
  });

  it("says what today's run will do and who changed the gate last", () => {
    render(<PipelineSwitches pipeline={gate()} />);
    expect(screen.getByText(/Action today: skipped_offseason\./)).toHaveTextContent(
      /by jyablonski/
    );
    actionState.current = { ok: false, message: "Not authorised." };
    render(<PipelineSwitches pipeline={gate({ reason: null })} />);
    expect(screen.getByText("Not authorised.")).toHaveClass("text-destructive");
  });
});

describe("AdminTabs", () => {
  const item = (overrides: Partial<ReviewItem>): ReviewItem => ({
    key: "k",
    level: "warn",
    title: "t",
    detail: "d",
    tab: "pipeline",
    ...overrides,
  });

  it("links every section and marks the open one", () => {
    render(<AdminTabs active="pipeline" items={[]} />);
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/admin",
      "/admin?tab=pipeline",
      "/admin?tab=models",
      "/admin?tab=infrastructure",
      "/admin?tab=settings",
    ]);
    expect(within(nav).getByRole("link", { name: "Pipeline" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(nav).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("counts what needs review on each tab, in red once something is blocking", () => {
    render(
      <AdminTabs
        active="overview"
        items={[
          item({ key: "a" }),
          item({ key: "b", level: "idle" }),
          item({ key: "c", level: "bad", tab: "infrastructure" }),
        ]}
      />
    );
    expect(screen.getByLabelText("2 to review")).toHaveClass("bg-warn");
    expect(screen.getByLabelText("1 to review")).toHaveClass("bg-destructive");
  });
});

describe("RunDuration", () => {
  const run = (overrides: Partial<PipelineRun>): PipelineRun => ({
    run_id: 1,
    triggered_by: "scheduled",
    status: "success",
    scrape_action: "daily",
    scrape_exit: 0,
    reddit_ran: true,
    reddit_exit: 0,
    dbt_exit: 0,
    dbt_failed_nodes: null,
    ml_exit: 0,
    detail: null,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_seconds: 100,
    ...overrides,
  });

  it("draws the runs oldest first, scaled to the longest", () => {
    render(
      <RunDuration
        runs={[
          run({ run_id: 4, duration_seconds: 200 }),
          run({ run_id: 3, duration_seconds: 100, status: "failed" }),
          run({ run_id: 2, duration_seconds: null, status: "running" }),
          run({ run_id: 1, duration_seconds: 0 }),
        ]}
      />
    );
    const bars = screen.getAllByRole("listitem");
    // The run still in flight has no duration to draw.
    expect(bars.map((bar) => bar.textContent)).toEqual([
      expect.stringContaining("#1"),
      expect.stringContaining("#3"),
      expect.stringContaining("#4"),
    ]);
    expect(screen.getByTestId("run-bar-4")).toHaveStyle({ height: "80%" });
    expect(screen.getByTestId("run-bar-3")).toHaveStyle({ height: "40%" });
    expect(screen.getByTestId("run-bar-3")).toHaveClass("bg-loss-bar");
    // A run that took no time is called out rather than drawn as nothing.
    expect(screen.getByTestId("run-bar-1")).toHaveClass("bg-warn");
    expect(screen.getByText("0s")).toHaveClass("text-warn");
    expect(screen.getByText("100s")).toHaveClass("text-destructive");
  });

  it("says so when there is nothing to chart", () => {
    render(<RunDuration runs={[run({ duration_seconds: null })]} />);
    expect(screen.getByText("No finished runs to chart yet.")).toBeInTheDocument();
  });
});

describe("Status", () => {
  it("labels a level with its own word unless given another", () => {
    const { container, rerender } = render(<Status level="warn" />);
    expect(screen.getByText("Degraded")).toHaveClass("text-warn");
    expect(container.querySelector("[data-level=warn]")).toHaveClass("bg-warn");
    rerender(<Status level="bad">failed</Status>);
    expect(screen.getByText("failed")).toHaveClass("text-destructive");
  });

  it("keeps the dot out of the accessible text", () => {
    const { container } = render(<StatusDot level="ok" className="extra" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
    expect(container.firstChild).toHaveClass("bg-primary", "extra");
  });

  it("clamps the meter to its track", () => {
    const { rerender } = render(<Meter value={0.676} label="Memory" />);
    expect(screen.getByRole("progressbar", { name: "Memory" })).toHaveAttribute(
      "aria-valuenow",
      "68"
    );
    rerender(<Meter value={4} label="Memory" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("Section", () => {
  it("pushes its note to the far edge unless asked to keep it inline", () => {
    const { rerender } = render(
      <Section title="Needs review" note="4 items">
        body
      </Section>
    );
    expect(screen.getByRole("heading", { name: "Needs review" })).toBeInTheDocument();
    expect(screen.getByText("4 items").parentElement).toHaveClass("justify-between");
    rerender(
      <Section title="Containers" note="6 running" noteAlign="inline">
        body
      </Section>
    );
    expect(screen.getByText("6 running").parentElement).not.toHaveClass("justify-between");
  });
});

describe("ModelsPanel", () => {
  const scorecardRow = {
    season: "2026-27",
    model_name: "elo",
    n: 4,
    brier: 0.2,
    home_always_accuracy: 0.5,
    market_n: 4,
    market_logloss: 0.575,
    market_brier: 0.197,
  };
  const game = (id: string, v1: number, v2: number, homeWon: boolean) => ({
    game_id: id,
    game_date: "2026-10-29",
    home_team_abbreviation: "POR",
    away_team_abbreviation: "MEM",
    home_won: homeWon,
    market_wp: 0.55,
    predictions: { "elo-v1": v1, "elo-v2": v2 },
  });
  const view = (serving = "elo-v1") =>
    buildModelReview({
      season: "2026-27",
      live_model_version: "elo-v1",
      serving_model_version: serving,
      models: [
        {
          model_version: "elo-v1",
          model_name: "elo",
          is_champion: true,
          promoted_at: "2026-10-20T12:00:00Z",
          promoted_by: "jacob",
        },
      ],
      rows: [
        {
          ...scorecardRow,
          model_version: "elo-v1",
          is_champion: true,
          logloss: 0.62,
          accuracy: 0.63,
          calibration_error: 0.107,
        },
        {
          ...scorecardRow,
          model_version: "elo-v2",
          is_champion: false,
          logloss: 0.61,
          accuracy: 0.62,
          calibration_error: 0.117,
        },
      ],
      games: [
        game("a", 0.6, 0.7, true),
        game("b", 0.6, 0.4, false),
        game("c", 0.4, 0.6, true),
        game("d", 0.55, 0.65, true),
        game("e", 0.6, 0.45, true),
      ],
    });

  beforeEach(() => {
    actionState.current = null;
  });

  it("shows the live model, its baselines, and only the rest as promotable", () => {
    render(<ModelsPanel view={view()} showLead />);
    expect(screen.getByText("on Schedule since Oct 20 · 4 games")).toBeInTheDocument();
    expect(screen.getByText("market 0.575 · lower is better")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "All models · 2026-27" })).toBeInTheDocument();

    const live = screen.getByTestId("model-elo-v1");
    expect(within(live).getByText("Live")).toBeInTheDocument();
    expect(within(live).queryByRole("button", { name: /Promote/ })).not.toBeInTheDocument();
    const shadow = screen.getByTestId("model-elo-v2");
    expect(within(shadow).getByText("Shadow")).toBeInTheDocument();
    expect(within(shadow).getByText("0.610")).toHaveClass("font-semibold");
    // Tied on Brier, so neither row stands out.
    expect(within(shadow).getByText("0.200")).not.toHaveClass("font-semibold");
    expect(screen.getByRole("row", { name: /Sportsbook market/ })).toHaveTextContent("0.575");
    expect(screen.getByRole("row", { name: /Always pick home/ })).toHaveTextContent("50%");
  });

  it("asks twice before changing what every visitor sees", () => {
    render(<ModelsPanel view={view()} showLead={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Promote to live" }));
    const confirm = screen.getByRole("button", { name: "Make Elo v2 live" });
    expect(confirm).toHaveAttribute("type", "submit");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Promote to live" })).toBeInTheDocument();
  });

  it("offers the reminder while a lead is inside noise", () => {
    render(<ModelsPanel view={view()} showLead />);
    const banner = screen.getByTestId("shadow-lead");
    expect(banner).toHaveTextContent("over the 5 games both predicted");
    expect(within(banner).getByRole("button", { name: "Remind me at 150" })).toBeInTheDocument();
  });

  it("switches the calibration chart to the clicked model", () => {
    render(<ModelsPanel view={view()} showLead={false} />);
    expect(screen.getByRole("heading", { name: "Calibration · Elo v1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Elo v2" }));
    expect(screen.getByRole("heading", { name: "Calibration · Elo v2" })).toBeInTheDocument();
  });

  it("narrows the log to games the calls split on", () => {
    render(<ModelsPanel view={view()} showLead={false} />);
    expect(screen.getAllByTestId("prediction-log-row")).toHaveLength(5);
    fireEvent.click(screen.getByRole("switch", { name: "Disagreements only" }));
    expect(screen.getAllByTestId("prediction-log-row")).toHaveLength(3);
  });

  it("says when the schedule has yet to catch up, and reports a refused promotion", () => {
    actionState.current = { ok: false, message: "This model has no predictions yet." };
    render(<ModelsPanel view={view("elo-v0")} showLead={false} />);
    expect(screen.getByText(/The schedule still shows/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("This model has no predictions yet.");
  });

  it("has an honest empty state", () => {
    render(
      <ModelsPanel
        view={buildModelReview({
          season: null,
          live_model_version: null,
          serving_model_version: null,
          models: [],
          rows: [],
          games: [],
        })}
        showLead={false}
      />
    );
    expect(screen.getByText(/No graded predictions yet/)).toBeInTheDocument();
  });
});
