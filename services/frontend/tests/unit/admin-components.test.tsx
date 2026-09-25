import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const actionState = vi.hoisted(() => ({
  current: null as { ok: boolean; message: string } | null,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/auth", () => ({ signOut }));
vi.mock("@/app/admin/actions", () => ({ requestJobAction: vi.fn() }));
// The form is never submitted here, so the real hook would always report a
// resting state; stubbing it lets both result branches render.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useActionState: () => [actionState.current, vi.fn(), false] };
});

import { AdminTable } from "@/components/admin/admin-table";
import { DbtBuildStatus, DBT_FAILED_NODES_CAP } from "@/components/admin/dbt-build-status";
import { JobButtons } from "@/components/admin/job-buttons";
import { RunsPager } from "@/components/admin/runs-pager";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { VmDiagnostics } from "@/components/admin/vm-diagnostics";
import type { DbtStatus, Diagnostics } from "@/lib/admin";

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
    expect(screen.getByText(/Only one runs at a time/)).toBeInTheDocument();
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

describe("SignOutButton", () => {
  it("signs out back to the sign-in page rather than the public site", async () => {
    const { container } = render(<SignOutButton />);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    // Landing anywhere else would look like a failed sign-out to the operator.
    await waitFor(() => {
      expect(signOut).toHaveBeenCalledWith({ redirectTo: "/admin/signin" });
    });
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
    expect(screen.getByRole("link", { name: "Older" })).toHaveAttribute("href", "/admin?runs=2");
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
    expect(screen.getByRole("link", { name: "Newer" })).toHaveAttribute("href", "/admin");
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
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("4.9 GB of 23 GB")).toBeInTheDocument();
    // Once as the container, once as the database user.
    expect(screen.getAllByText("postgres")).toHaveLength(2);
    expect(screen.getByText("291 MB / 2.0 GB")).toBeInTheDocument();
    expect(screen.getByText("Site (Caddy)")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.9 ×2, 198.51.100.4 ×1")).toBeInTheDocument();
    expect(screen.getByText(/6 of 100 connections/)).toBeInTheDocument();
    expect(screen.getByText("external")).toBeInTheDocument();
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
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("OOM killed")).toBeInTheDocument();
    expect(screen.getByText("exited (137)")).toBeInTheDocument();
    expect(screen.getByText("running unhealthy")).toBeInTheDocument();
    expect(screen.getByText("nba-cube-1")).toBeInTheDocument();
    expect(screen.getByText("(job)")).toBeInTheDocument();
    expect(screen.getByText("MCP")).toBeInTheDocument();
    expect(screen.getByText("other")).toBeInTheDocument();
    expect(screen.getByText(/TimeoutExpired/)).toBeInTheDocument();
    expect(screen.getByText("local socket")).toBeInTheDocument();
    expect(screen.getByText("15m")).toBeInTheDocument();
    expect(screen.getByText("2.9 GB")).toBeInTheDocument();
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
    expect(screen.queryByText("Memory used")).not.toBeInTheDocument();
  });

  it("explains a missing or stale snapshot", () => {
    const { unmount } = render(<VmDiagnostics diagnostics={{ ...diagnostics, snapshot: null }} />);
    expect(screen.getByText(/No host snapshot yet/)).toBeInTheDocument();
    unmount();
    const stale = new Date(Date.now() - 30 * 60_000).toISOString();
    render(
      <VmDiagnostics
        diagnostics={{ ...diagnostics, snapshot: { ...diagnostics.snapshot!, captured_at: stale } }}
      />
    );
    expect(screen.getByText(/stale: the admin-jobs cron/)).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
  });
});
