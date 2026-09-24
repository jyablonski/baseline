"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AdminApiError, enqueueAdminJob, isJobType } from "@/lib/admin";
import { adminJobsEnabled, isAllowedLogin } from "@/lib/admin-access";

export type JobActionState = { ok: boolean; message: string } | null;

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
  const login = session?.user?.login;
  if (!isAllowedLogin(login)) {
    return { ok: false, message: "Not authorised." };
  }
  if (!adminJobsEnabled()) {
    return { ok: false, message: "Jobs are disabled on this deployment." };
  }

  const jobType = formData.get("job_type");
  if (!isJobType(jobType)) {
    return { ok: false, message: "Unknown job type." };
  }

  try {
    const job = await enqueueAdminJob(jobType, login as string);
    revalidatePath("/admin");
    return { ok: true, message: `Queued ${jobType} as job #${job.job_id}.` };
  } catch (error) {
    if (error instanceof AdminApiError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Could not queue the job." };
  }
}
