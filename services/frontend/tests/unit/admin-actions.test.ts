import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server actions are their own HTTP entry point and do not pass through
 * middleware, so this is a mutating endpoint anyone can POST to. The auth
 * re-check and the job-type validation are the only things in front of it,
 * which makes them worth testing directly.
 *
 * Note this file lives under src/app, which vitest.config.ts excludes from
 * coverage — it will not appear in the report either way.
 */
const session = vi.hoisted(() => ({ current: null as { user?: { login?: string } } | null }));
const enqueue = vi.hoisted(() => vi.fn());
const revalidate = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: async () => session.current }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("@/lib/admin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin")>("@/lib/admin");
  return { ...actual, enqueueAdminJob: enqueue };
});

import { requestJobAction } from "@/app/admin/actions";
import { AdminApiError } from "@/lib/admin";

function form(jobType?: string): FormData {
  const data = new FormData();
  if (jobType !== undefined) data.set("job_type", jobType);
  return data;
}

describe("requestJobAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_GITHUB_LOGINS", "allowed-user");
    vi.stubEnv("ADMIN_JOBS_ENABLED", "true");
    session.current = { user: { login: "allowed-user" } };
  });

  it("refuses a signed-out caller without queueing anything", async () => {
    session.current = null;
    await expect(requestJobAction(null, form("scrape"))).resolves.toEqual({
      ok: false,
      message: "Not authorised.",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses a signed-in caller who is not on the allowlist", async () => {
    session.current = { user: { login: "stranger" } };
    await expect(requestJobAction(null, form("refresh"))).resolves.toMatchObject({ ok: false });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses to queue when jobs are disabled, since nothing would run them", async () => {
    vi.stubEnv("ADMIN_JOBS_ENABLED", "");
    await expect(requestJobAction(null, form("refresh"))).resolves.toEqual({
      ok: false,
      message: "Jobs are disabled on this deployment.",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects a job type the form was not supposed to be able to send", async () => {
    // The field is attacker-controlled, so validation happens here rather than
    // trusting the four buttons the UI renders.
    await expect(requestJobAction(null, form("drop-tables"))).resolves.toEqual({
      ok: false,
      message: "Unknown job type.",
    });
    await expect(requestJobAction(null, form())).resolves.toEqual({
      ok: false,
      message: "Unknown job type.",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues the job for the authenticated login and revalidates the console", async () => {
    enqueue.mockResolvedValue({ job_id: 12 });
    await expect(requestJobAction(null, form("dbt"))).resolves.toEqual({
      ok: true,
      message: "Queued dbt as job #12.",
    });
    // Requester is taken from the session, never from the form.
    expect(enqueue).toHaveBeenCalledWith("dbt", "allowed-user");
    expect(revalidate).toHaveBeenCalledWith("/admin");
  });

  it("passes an admin API message through, such as a 409 conflict", async () => {
    enqueue.mockRejectedValue(new AdminApiError("A job is already running.", 409));
    await expect(requestJobAction(null, form("ml"))).resolves.toEqual({
      ok: false,
      message: "A job is already running.",
    });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("does not leak an unexpected error to the operator", async () => {
    enqueue.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.4:8000"));
    await expect(requestJobAction(null, form("scrape"))).resolves.toEqual({
      ok: false,
      message: "Could not queue the job.",
    });
  });
});
