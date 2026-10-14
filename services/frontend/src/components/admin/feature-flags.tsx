"use client";

import { useActionState } from "react";

import { setFlagAction, type JobActionState } from "@/app/admin/actions";
import { ToggleSwitch } from "@/components/admin/toggle-switch";
import { formatAge } from "@/lib/admin-status";
import type { FeatureFlag } from "@/lib/admin";
import { cn } from "@/lib/utils";

/** One switch per feature. A change applies to the next request; no deploy. */
export function FeatureFlags({ flags }: { flags: FeatureFlag[] }) {
  const [state, formAction] = useActionState<JobActionState, FormData>(setFlagAction, null);

  if (flags.length === 0) {
    return <p className="text-sm text-muted-foreground">No feature flags are defined.</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-rule border-b border-rule">
        {flags.map((flag) => (
          <li
            key={flag.flag_key}
            className="flex flex-wrap items-center justify-between gap-3 py-4"
            data-testid={`flag-${flag.flag_key}`}
          >
            <div className="min-w-0 space-y-1">
              <p className="font-mono font-medium">{flag.flag_key}</p>
              <p className="text-foreground">{flag.description}</p>
              <p className="type-caption">
                {flag.updated_by
                  ? `Last changed ${formatAge(flag.updated_at)} by ${flag.updated_by}`
                  : "Never changed"}
              </p>
            </div>
            <form action={formAction} className="flex items-center gap-6">
              <input type="hidden" name="flag_key" value={flag.flag_key} />
              <input type="hidden" name="enabled" value={flag.enabled ? "false" : "true"} />
              <span className={cn("text-sm", flag.enabled ? "text-primary" : "text-ink-3")}>
                {flag.enabled ? "On" : "Off"}
              </span>
              <ToggleSwitch checked={flag.enabled} label={flag.flag_key} />
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
