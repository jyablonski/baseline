"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { requestJobAction, type JobActionState } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import type { JobType } from "@/lib/admin";

const JOBS: { type: JobType; label: string }[] = [
  { type: "scrape", label: "Re-run ingestion" },
  { type: "dbt", label: "Re-run dbt" },
  { type: "ml", label: "Re-run ML" },
  { type: "refresh", label: "Full refresh" },
];

/** How often to re-read the page while a job is queued or running. */
const POLL_MS = 10_000;

function JobButton({ type, label, disabled }: { type: JobType; label: string; disabled: boolean }) {
  const { pending, data } = useFormStatus();
  // useFormStatus is form-scoped, so without checking which button submitted,
  // every button in the form would show "Queueing…" on any click.
  const isThisButton = data?.get("job_type") === type;
  return (
    <Button
      type="submit"
      name="job_type"
      value={type}
      variant="outline"
      size="sm"
      disabled={pending || disabled}
    >
      {pending && isThisButton ? "Queueing…" : label}
    </Button>
  );
}

export function JobButtons({
  hasPendingJob,
  enabled,
}: {
  hasPendingJob: boolean;
  enabled: boolean;
}) {
  const [state, formAction] = useActionState<JobActionState, FormData>(requestJobAction, null);
  const router = useRouter();

  // Jobs are picked up by a host runner up to a minute later and then take
  // minutes to finish. Without this the page would sit stale until a manual
  // reload, which is the opposite of an at-a-glance view. With jobs disabled
  // there is no runner, so a pending job never moves and polling would spin.
  useEffect(() => {
    if (!hasPendingJob || !enabled) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [hasPendingJob, enabled, router]);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap gap-2">
        {JOBS.map((job) => (
          <JobButton
            key={job.type}
            type={job.type}
            label={job.label}
            disabled={!enabled || hasPendingJob}
          />
        ))}
      </form>
      <p className="text-xs text-muted-foreground">
        {!enabled
          ? "Jobs are disabled here: only production runs queued jobs. Run the equivalent make target locally instead."
          : hasPendingJob
            ? "A job is queued or running. This page refreshes itself until it finishes."
            : "Jobs start within about a minute. Only one runs at a time, and a job never overlaps the daily refresh."}
      </p>
      {state ? (
        <p
          className={
            state.ok
              ? "text-xs text-muted-foreground"
              : "bg-destructive/10 px-3 py-2 text-xs text-destructive"
          }
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
