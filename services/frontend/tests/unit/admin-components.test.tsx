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
import { JobButtons } from "@/components/admin/job-buttons";
import { SignOutButton } from "@/components/admin/sign-out-button";

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
