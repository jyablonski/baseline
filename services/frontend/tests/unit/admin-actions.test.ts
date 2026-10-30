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
type TestUser = { provider?: string; login?: string; email?: string; verifiedEmail?: boolean };
const session = vi.hoisted(() => ({ current: null as { user?: TestUser } | null }));
const setFlag = vi.hoisted(() => vi.fn());
const setPipeline = vi.hoisted(() => vi.fn());
const enqueue = vi.hoisted(() => vi.fn());
const promote = vi.hoisted(() => vi.fn());
const cookieSet = vi.hoisted(() => vi.fn());
const revalidate = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: async () => session.current }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet }) }));
vi.mock("@/lib/admin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin")>("@/lib/admin");
  return {
    ...actual,
    enqueueAdminJob: enqueue,
    promoteAdminModel: promote,
    setAdminFlag: setFlag,
    setAdminPipeline: setPipeline,
  };
});

import {
  promoteModelAction,
  remindModelAction,
  requestJobAction,
  setFlagAction,
  setPipelineAction,
} from "@/app/admin/actions";
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
    session.current = { user: { provider: "github", login: "allowed-user" } };
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
    session.current = { user: { provider: "github", login: "stranger" } };
    await expect(requestJobAction(null, form("refresh"))).resolves.toMatchObject({ ok: false });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses an ordinary signed-in user, who now holds a real session", async () => {
    // Public sign-up means a session proves nothing about being the operator.
    session.current = {
      user: { provider: "google", email: "visitor@example.com", verifiedEmail: true },
    };
    await expect(requestJobAction(null, form("refresh"))).resolves.toEqual({
      ok: false,
      message: "Not authorised.",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues for the owner signed in with Google, recorded by email", async () => {
    vi.stubEnv("ADMIN_GOOGLE_EMAILS", "owner@example.com");
    session.current = {
      user: { provider: "google", email: "owner@example.com", verifiedEmail: true },
    };
    enqueue.mockResolvedValue({ job_id: 3 });
    await expect(requestJobAction(null, form("ml"))).resolves.toMatchObject({ ok: true });
    expect(enqueue).toHaveBeenCalledWith("ml", "owner@example.com");
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

function flagForm(flagKey?: string, enabled?: string): FormData {
  const data = new FormData();
  if (flagKey !== undefined) data.set("flag_key", flagKey);
  if (enabled !== undefined) data.set("enabled", enabled);
  return data;
}

describe("setFlagAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_GITHUB_LOGINS", "allowed-user");
    session.current = { user: { provider: "github", login: "allowed-user" } };
  });

  it("refuses anyone who is not the operator without touching the flag", async () => {
    for (const user of [
      null,
      { user: { provider: "github", login: "stranger" } },
      { user: { provider: "google", email: "visitor@example.com", verifiedEmail: true } },
    ]) {
      session.current = user;
      await expect(setFlagAction(null, flagForm("chatbot", "false"))).resolves.toEqual({
        ok: false,
        message: "Not authorised.",
      });
    }
    expect(setFlag).not.toHaveBeenCalled();
  });

  it("rejects a form that names no flag or no clear on/off value", async () => {
    for (const data of [flagForm(), flagForm("chatbot"), flagForm("chatbot", "maybe")]) {
      await expect(setFlagAction(null, data)).resolves.toEqual({
        ok: false,
        message: "Unknown feature flag.",
      });
    }
    expect(setFlag).not.toHaveBeenCalled();
  });

  it("switches the flag as the signed-in operator and revalidates the console", async () => {
    setFlag.mockResolvedValue({ flag_key: "chatbot", enabled: false });
    await expect(setFlagAction(null, flagForm("chatbot", "false"))).resolves.toEqual({
      ok: true,
      message: "chatbot is now off.",
    });
    expect(setFlag).toHaveBeenCalledWith("chatbot", false, "allowed-user");
    expect(revalidate).toHaveBeenCalledWith("/admin");

    setFlag.mockResolvedValue({ flag_key: "chatbot", enabled: true });
    await expect(setFlagAction(null, flagForm("chatbot", "true"))).resolves.toMatchObject({
      message: "chatbot is now on.",
    });
  });

  it("passes an API message through and hides anything unexpected", async () => {
    setFlag.mockRejectedValue(new AdminApiError("Unknown feature flag.", 404));
    await expect(setFlagAction(null, flagForm("nope", "true"))).resolves.toEqual({
      ok: false,
      message: "Unknown feature flag.",
    });
    setFlag.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.4:8000"));
    await expect(setFlagAction(null, flagForm("chatbot", "true"))).resolves.toEqual({
      ok: false,
      message: "Could not change the flag.",
    });
  });
});

function pipelineForm(key?: string, value?: string): FormData {
  const data = new FormData();
  if (key !== undefined) data.set("switch", key);
  if (value !== undefined) data.set("value", value);
  return data;
}

describe("setPipelineAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_GITHUB_LOGINS", "allowed-user");
    session.current = { user: { provider: "github", login: "allowed-user" } };
  });

  it("refuses anyone who is not the operator without touching the gate", async () => {
    for (const user of [null, { user: { provider: "github", login: "stranger" } }]) {
      session.current = user;
      await expect(setPipelineAction(null, pipelineForm("enabled", "false"))).resolves.toEqual({
        ok: false,
        message: "Not authorised.",
      });
    }
    expect(setPipeline).not.toHaveBeenCalled();
  });

  it("rejects a switch the form was not supposed to be able to send", async () => {
    for (const data of [
      pipelineForm(),
      pipelineForm("scrape_mode", "true"),
      pipelineForm("enabled", "maybe"),
    ]) {
      await expect(setPipelineAction(null, data)).resolves.toEqual({
        ok: false,
        message: "Unknown pipeline switch.",
      });
    }
    expect(setPipeline).not.toHaveBeenCalled();
  });

  it("flips the switch as the operator and reports what today's run will do", async () => {
    setPipeline.mockResolvedValue({
      enabled: true,
      season_active: false,
      action_today: "skipped_offseason",
    });
    await expect(setPipelineAction(null, pipelineForm("season_active", "false"))).resolves.toEqual({
      ok: true,
      message: "The season is now off. Action today: skipped_offseason.",
    });
    expect(setPipeline).toHaveBeenCalledWith("season_active", false, "allowed-user");
    expect(revalidate).toHaveBeenCalledWith("/admin");
  });

  it("passes an API message through and hides anything unexpected", async () => {
    setPipeline.mockRejectedValue(new AdminApiError("ADMIN_API_TOKEN is not set.", 503));
    await expect(setPipelineAction(null, pipelineForm("enabled", "true"))).resolves.toEqual({
      ok: false,
      message: "ADMIN_API_TOKEN is not set.",
    });
    setPipeline.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(setPipelineAction(null, pipelineForm("enabled", "true"))).resolves.toEqual({
      ok: false,
      message: "Could not change the pipeline.",
    });
  });
});

describe("promoteModelAction", () => {
  const promotion = (version?: string) => {
    const data = new FormData();
    if (version) data.set("model_version", version);
    return data;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_GITHUB_LOGINS", "allowed-user");
    vi.stubEnv("ADMIN_JOBS_ENABLED", "true");
    session.current = { user: { provider: "github", login: "allowed-user" } };
  });

  it("refuses anyone who is not the admin", async () => {
    session.current = { user: { provider: "github", login: "stranger" } };
    await expect(promoteModelAction(null, promotion("elo-v2"))).resolves.toMatchObject({
      ok: false,
    });
    expect(promote).not.toHaveBeenCalled();
  });

  it("refuses a missing model", async () => {
    await expect(promoteModelAction(null, promotion())).resolves.toEqual({
      ok: false,
      message: "Unknown model.",
    });
  });

  it("promotes as the operator and says the rebuild is queued", async () => {
    promote.mockResolvedValue({ model_version: "elo-v2", rebuild_queued: true });
    const result = await promoteModelAction(null, promotion("elo-v2"));
    expect(promote).toHaveBeenCalledWith("elo-v2", "allowed-user", true);
    expect(result).toMatchObject({ ok: true });
    expect(result?.message).toContain("queued dbt job");
    expect(revalidate).toHaveBeenCalledWith("/admin");
  });

  it("asks for no rebuild where no runner would pick it up", async () => {
    vi.stubEnv("ADMIN_JOBS_ENABLED", "");
    promote.mockResolvedValue({ model_version: "elo-v2", rebuild_queued: false });
    const result = await promoteModelAction(null, promotion("elo-v2"));
    expect(promote).toHaveBeenCalledWith("elo-v2", "allowed-user", false);
    expect(result?.message).toContain("next dbt run");
  });

  it("passes on the API's reason and hides anything unexpected", async () => {
    promote.mockRejectedValueOnce(new AdminApiError("No predictions yet.", 409));
    await expect(promoteModelAction(null, promotion("logit-v1"))).resolves.toEqual({
      ok: false,
      message: "No predictions yet.",
    });
    promote.mockRejectedValueOnce(new Error("boom"));
    await expect(promoteModelAction(null, promotion("logit-v1"))).resolves.toEqual({
      ok: false,
      message: "Could not promote the model.",
    });
  });
});

describe("remindModelAction", () => {
  const reminder = () => {
    const data = new FormData();
    data.set("model_version", "elo-v2");
    return data;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_GITHUB_LOGINS", "allowed-user");
    session.current = { user: { provider: "github", login: "allowed-user" } };
  });

  it("remembers the model for the admin alone", async () => {
    await remindModelAction(reminder());
    expect(cookieSet).toHaveBeenCalledWith(
      "baseline_model_reminder",
      "elo-v2",
      expect.objectContaining({ httpOnly: true, path: "/admin" })
    );
    expect(revalidate).toHaveBeenCalledWith("/admin");
  });

  it("does nothing for anyone else", async () => {
    session.current = null;
    await remindModelAction(reminder());
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
