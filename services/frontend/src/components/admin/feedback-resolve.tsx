"use client";

import { useActionState } from "react";

import { setFeedbackResolvedAction, type JobActionState } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

export function FeedbackResolve({
  feedbackId,
  resolved,
}: {
  feedbackId: string;
  resolved: boolean;
}) {
  const [state, formAction, pending] = useActionState<JobActionState, FormData>(
    setFeedbackResolvedAction,
    null
  );
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="feedback_id" value={feedbackId} />
      <input type="hidden" name="resolved" value={resolved ? "false" : "true"} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {resolved ? "Reopen" : "Resolve"}
      </Button>
      {state && !state.ok ? (
        <p className="text-xs text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
