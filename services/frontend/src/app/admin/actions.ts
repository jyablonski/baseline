"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { auth } from "@/auth";
import {
  AdminApiError,
  enqueueAdminJob,
  isJobType,
  isPipelineSwitch,
  promoteAdminModel,
  setAdminFlag,
  setAdminPipeline,
} from "@/lib/admin";
import { adminJobsEnabled, isAdminUser } from "@/lib/admin-access";
import { MODEL_REMINDER_COOKIE } from "@/lib/model-review";

export type JobActionState = { ok: boolean; message: string } | null;

/** Who to record against a job or flag change: audit only, never authority. */
function operatorName(user: { login?: string; email?: string | null } | undefined): string {
  return user?.login || user?.email || "admin";
}

/**
 * Queue an operator job.
 *
 * Server actions are their own HTTP entry point and do NOT pass through
 * middleware, so re-checking the session here is mandatory rather than
 * defensive: without it this would be a mutating endpoint reachable by anyone
 * who can POST to the app. The job type is validated server-side too — the
 * form field is attacker-controlled.
 */
export async function requestJobAction(
  _previous: JobActionState,
  formData: FormData
): Promise<JobActionState> {
  const session = await auth();
  if (!isAdminUser(session?.user)) {
    return { ok: false, message: "Not authorised." };
  }
  const operator = operatorName(session?.user);
  if (!adminJobsEnabled()) {
    return { ok: false, message: "Jobs are disabled on this deployment." };
  }

  const jobType = formData.get("job_type");
  if (!isJobType(jobType)) {
    return { ok: false, message: "Unknown job type." };
  }

  try {
    const job = await enqueueAdminJob(jobType, operator);
    revalidatePath("/admin");
    return { ok: true, message: `Queued ${jobType} as job #${job.job_id}.` };
  } catch (error) {
    if (error instanceof AdminApiError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Could not queue the job." };
  }
}

/**
 * Switch a feature flag. The same rules as queueing a job: this is a public
 * POST endpoint, so the admin check here is the gate, not a formality.
 */
export async function setFlagAction(
  _previous: JobActionState,
  formData: FormData
): Promise<JobActionState> {
  const session = await auth();
  if (!isAdminUser(session?.user)) {
    return { ok: false, message: "Not authorised." };
  }

  const flagKey = formData.get("flag_key");
  const enabled = formData.get("enabled");
  if (typeof flagKey !== "string" || !flagKey || (enabled !== "true" && enabled !== "false")) {
    return { ok: false, message: "Unknown feature flag." };
  }

  try {
    const flag = await setAdminFlag(flagKey, enabled === "true", operatorName(session?.user));
    revalidatePath("/admin");
    return { ok: true, message: `${flag.flag_key} is now ${flag.enabled ? "on" : "off"}.` };
  } catch (error) {
    if (error instanceof AdminApiError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Could not change the flag." };
  }
}

const PIPELINE_SWITCH_NAMES = { enabled: "The pipeline", season_active: "The season" } as const;

/** Flip the scrape gate or the season. Same gate as flags: the admin check here is the lock. */
export async function setPipelineAction(
  _previous: JobActionState,
  formData: FormData
): Promise<JobActionState> {
  const session = await auth();
  if (!isAdminUser(session?.user)) {
    return { ok: false, message: "Not authorised." };
  }

  const key = formData.get("switch");
  const value = formData.get("value");
  if (!isPipelineSwitch(key) || (value !== "true" && value !== "false")) {
    return { ok: false, message: "Unknown pipeline switch." };
  }

  try {
    const gate = await setAdminPipeline(key, value === "true", operatorName(session?.user));
    revalidatePath("/admin");
    return {
      ok: true,
      message: `${PIPELINE_SWITCH_NAMES[key]} is now ${gate[key] ? "on" : "off"}. Action today: ${gate.action_today}.`,
    };
  } catch (error) {
    if (error instanceof AdminApiError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Could not change the pipeline." };
  }
}

/**
 * Make a model the live one. Same gate as the others. Runs on the API, which
 * also queues the dbt rebuild that puts it on the schedule; with no host runner
 * here that job would sit queued forever, so none is asked for.
 */
export async function promoteModelAction(
  _previous: JobActionState,
  formData: FormData
): Promise<JobActionState> {
  const session = await auth();
  if (!isAdminUser(session?.user)) {
    return { ok: false, message: "Not authorised." };
  }

  const modelVersion = formData.get("model_version");
  if (typeof modelVersion !== "string" || !modelVersion) {
    return { ok: false, message: "Unknown model." };
  }

  try {
    const change = await promoteAdminModel(
      modelVersion,
      operatorName(session?.user),
      adminJobsEnabled()
    );
    revalidatePath("/admin");
    return {
      ok: true,
      message: change.rebuild_queued
        ? `${change.model_version} is live. The schedule switches when the queued dbt job finishes.`
        : `${change.model_version} is live. The schedule switches on the next dbt run.`,
    };
  } catch (error) {
    if (error instanceof AdminApiError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Could not promote the model." };
  }
}

/**
 * Quiet the "shadow is ahead" review until that model has enough games. Kept in
 * a cookie: the reminder is one operator's, and nothing outside /admin reads it.
 */
export async function remindModelAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!isAdminUser(session?.user)) return;

  const modelVersion = formData.get("model_version");
  if (typeof modelVersion !== "string" || !modelVersion) return;

  (await cookies()).set(MODEL_REMINDER_COOKIE, modelVersion, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/admin");
}
