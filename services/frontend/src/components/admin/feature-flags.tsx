"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { setFlagAction, type JobActionState } from "@/app/admin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAge } from "@/lib/admin-status";
import type { FeatureFlag } from "@/lib/admin";

function FlagButton({ flag }: { flag: FeatureFlag }) {
  const { pending, data } = useFormStatus();
  // Form-scoped status: only the row that was clicked shows "Saving…".
  const isThisFlag = data?.get("flag_key") === flag.flag_key;
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending && isThisFlag ? "Saving…" : flag.enabled ? "Turn off" : "Turn on"}
    </Button>
  );
}

/** One switch per feature. A change applies to the next request; no deploy. */
export function FeatureFlags({ flags }: { flags: FeatureFlag[] }) {
  const [state, formAction] = useActionState<JobActionState, FormData>(setFlagAction, null);

  if (flags.length === 0) {
    return <p className="text-sm text-muted-foreground">No feature flags are defined.</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-rule">
        {flags.map((flag) => (
          <li
            key={flag.flag_key}
            className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
            data-testid={`flag-${flag.flag_key}`}
          >
            <div className="min-w-0 space-y-1">
              <p className="flex items-center gap-2 font-medium">
                {flag.flag_key}
                <Badge variant={flag.enabled ? "default" : "secondary"}>
                  {flag.enabled ? "On" : "Off"}
                </Badge>
              </p>
              <p className="text-sm text-muted-foreground">{flag.description}</p>
              <p className="text-xs text-muted-foreground">
                {flag.updated_by
                  ? `Last changed ${formatAge(flag.updated_at)} by ${flag.updated_by}`
                  : "Never changed"}
              </p>
            </div>
            <form action={formAction}>
              <input type="hidden" name="flag_key" value={flag.flag_key} />
              <input type="hidden" name="enabled" value={flag.enabled ? "false" : "true"} />
              <FlagButton flag={flag} />
            </form>
          </li>
        ))}
      </ul>
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
