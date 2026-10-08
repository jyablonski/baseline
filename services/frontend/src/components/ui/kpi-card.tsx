import * as React from "react";

import { cn } from "@/lib/utils";

/** A ruled row of KPI cards: one column on a phone, two, then four across. */
function KpiStrip({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="kpi-strip"
      className={cn(
        "grid border-y border-rule-strong sm:grid-cols-2 lg:grid-cols-4",
        // Dividers follow the column count, so the last card in a row has none.
        "max-sm:[&>*+*]:border-t sm:max-lg:[&>*:nth-child(odd)]:border-r sm:max-lg:[&>*:nth-child(n+3)]:border-t lg:[&>*:not(:last-child)]:border-r",
        className
      )}
      {...props}
    />
  );
}

function KpiCard({
  label,
  value,
  note,
  progress,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: string;
  /** A string or number renders as the headline figure; pass a node for anything else. */
  value: React.ReactNode;
  note?: React.ReactNode;
  /** Share of a whole, 0 to 1. Draws a meter under the value. */
  progress?: number;
}) {
  const isFigure = typeof value === "string" || typeof value === "number";
  return (
    <div
      data-slot="kpi-card"
      className={cn("border-rule px-[var(--ct-space-4)] py-[var(--ct-space-4)]", className)}
      {...props}
    >
      <p className="type-caption">{label}</p>
      <div className="mt-2">
        {isFigure ? <KpiFigure>{value}</KpiFigure> : value}
        {progress == null ? null : <KpiMeter value={progress} />}
        {note ? <p className="type-caption mt-2">{note}</p> : null}
      </div>
    </div>
  );
}

function KpiFigure({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="kpi-figure"
      className={cn(
        "tabular block text-[length:var(--ct-fs-entity)] leading-none font-semibold",
        className
      )}
      {...props}
    />
  );
}

/** The headline when it is a name or a title rather than a number. */
function KpiTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="kpi-title"
      className={cn("type-module block leading-snug", className)}
      {...props}
    />
  );
}

function KpiMeter({ value }: { value: number }) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="mt-3 h-[3px] bg-rule"
    >
      <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}

export { KpiCard, KpiFigure, KpiStrip, KpiTitle };
