"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AdminApiError, enqueueAdminJob, isJobType, setAdminFlag } from "@/lib/admin";
import { adminJobsEnabled, isAdminUser } from "@/lib/admin-access";

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
