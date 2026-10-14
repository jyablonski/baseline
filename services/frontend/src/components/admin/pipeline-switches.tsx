"use client";

import { useActionState } from "react";

import { setPipelineAction, type JobActionState } from "@/app/admin/actions";
import { ToggleSwitch } from "@/components/admin/toggle-switch";
import type { PipelineGate, PipelineSwitch } from "@/lib/admin";
import { cn } from "@/lib/utils";

const SWITCHES: { key: PipelineSwitch; label: string; description: string }[] = [
  {
    key: "enabled",
    label: "Pipeline",
    description:
      "The scheduled scrape as a whole. Off skips every source and dbt until it is turned back on.",
  },
  {
    key: "season_active",
    label: "Season active",
    description:
      "The NBA daily scrape: slate, game logs, play-by-play, standings, injuries, odds, broadcasts. Contracts, transactions, and Reddit run either way.",
  },
];

/** The scrape gate's two switches. The next scheduled run obeys them; no deploy. */
export function PipelineSwitches({ pipeline }: { pipeline: PipelineGate }) {
  const [state, formAction] = useActionState<JobActionState, FormData>(setPipelineAction, null);

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-rule border-b border-rule">
        {SWITCHES.map(({ key, label, description }) => (
          <li
            key={key}
            className="flex flex-wrap items-center justify-between gap-3 py-4"
            data-testid={`pipeline-${key}`}
          >
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{label}</p>
              <p className="text-foreground">{description}</p>
            </div>
            <form action={formAction} className="flex items-center gap-6">
              <input type="hidden" name="switch" value={key} />
              <input type="hidden" name="value" value={pipeline[key] ? "false" : "true"} />
              <span className={cn("text-sm", pipeline[key] ? "text-primary" : "text-ink-3")}>
                {pipeline[key] ? "On" : "Off"}
              </span>
              <ToggleSwitch checked={pipeline[key]} label={label} />
            </form>
          </li>
        ))}
      </ul>
      <p className="type-caption">
        Action today: {pipeline.action_today}.{" "}
        {pipeline.reason ? `Last change: ${pipeline.reason}` : ""}
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
