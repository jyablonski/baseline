import {
  CAP_BAND_CLASS,
  capBarBands,
  capDistances,
  capPercent,
  capRestrictions,
  capScale,
  capTier,
  capTierLabel,
  layoutCapBarMarkers,
  resolveCapFlags,
} from "@/lib/cba";
import type { CapBandTone } from "@/lib/cba";
import { formatUsdMillions } from "@/lib/format";
import { cn } from "@/lib/utils";

export type CapPositionTeam = {
  current_season_payroll?: number | null;
  current_remaining_guaranteed?: number | null;
  current_contract_season?: string | null;
  salary_cap?: number | null;
  luxury_tax?: number | null;
  first_apron?: number | null;
  second_apron?: number | null;
  over_luxury_tax?: boolean | null;
  over_first_apron?: boolean | null;
  over_second_apron?: boolean | null;
};

const CAP_ZONE_LABEL: Record<CapBandTone, string> = {
  under: "Under tax",
  tax: "Taxpayer",
  first: "Over 1st apron",
  second: "Over 2nd apron",
};

const CAP_ZONE_TEXT_CLASS: Record<CapBandTone, string> = {
  under: "text-foreground",
  tax: "text-ink-2",
  first: "text-destructive",
  second: "text-primary-foreground",
};

function thresholdName(id: "tax" | "first" | "second") {
  if (id === "tax") return "tax line";
  return id === "first" ? "1st apron" : "2nd apron";
}

function capPositionScale(
  payroll: number | null,
  salaryCap: number | null | undefined,
  lines: { luxury_tax?: number | null; first_apron?: number | null; second_apron?: number | null }
) {
  const thresholds = [lines.luxury_tax, lines.first_apron, lines.second_apron].filter(
    (value): value is number => value != null && !Number.isNaN(value)
  );
  if (thresholds.length === 0) return capScale([payroll, salaryCap]);

  const lowestLine = lines.luxury_tax ?? Math.min(...thresholds);
  const highestLine = lines.second_apron ?? Math.max(...thresholds);
  // Keep the chart focused on tax-to-apron thresholds; low payrolls pin to the left edge.
  const min = lowestLine * 0.95;
  const max = highestLine * 1.04;
  return {
    max: Math.max(max, payroll ?? max),
    min,
  };
}

export function CapPosition({ team }: { team: CapPositionTeam }) {
  const payroll = team.current_season_payroll ?? null;
  const remaining = team.current_remaining_guaranteed ?? null;
  const lines = {
    luxury_tax: team.luxury_tax,
    first_apron: team.first_apron,
    second_apron: team.second_apron,
  };
  const flags = resolveCapFlags(team, payroll, lines);
  const tier = capTier(flags);
  const scale = capPositionScale(payroll, team.salary_cap, lines);
  const bands = scale ? capBarBands(scale, lines) : [];
  const markers = scale
    ? layoutCapBarMarkers(
        [
          { id: "tax", label: "Luxury tax", value: team.luxury_tax },
          { id: "first", label: "1st apron", value: team.first_apron },
          { id: "second", label: "2nd apron", value: team.second_apron },
        ],
        scale
      )
    : [];
  const pinPct = scale && payroll != null ? capPercent(payroll, scale.min, scale.max) : null;
  const distances = capDistances(payroll, lines);
  const taxDistance = distances.find((row) => row.id === "tax") ?? null;
  const primaryDistance =
    [...distances].reverse().find((row) => row.over) ??
    distances.find((row) => row.id === "tax") ??
    distances[0] ??
    null;
  const restrictions = tier ? capRestrictions(tier) : [];
  const hasMoney = payroll != null || remaining != null || team.luxury_tax != null;
  const chartZones = new Set<CapBandTone>(
    [
      team.luxury_tax != null ? "under" : null,
      team.luxury_tax != null && team.first_apron != null ? "tax" : null,
      team.first_apron != null && team.second_apron != null ? "first" : null,
      team.second_apron != null ? "second" : null,
    ].filter((zone): zone is CapBandTone => zone != null)
  );

  return (
    <section className="border-y border-border py-6">
      {!hasMoney ? (
        <p className="text-sm text-ink-2">No BRef payroll snapshot for this team yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-6">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <p className="type-eyebrow">
                  Cap position
                  {team.current_contract_season ? ` · ${team.current_contract_season}` : ""}
                </p>
                {tier ? (
                  <span
                    className={cn(
                      "px-2 py-1 text-[10px] font-semibold tracking-wide uppercase",
                      tier >= 3 && "bg-destructive text-primary-foreground",
                      tier === 2 && "bg-secondary text-foreground",
                      tier === 1 && "bg-primary text-primary-foreground"
                    )}
                  >
                    {capTierLabel(tier).replace(" (", " · ").replace(")", "")}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="text-4xl font-semibold tracking-tight tabular sm:text-5xl">
                  {formatUsdMillions(payroll)}
                </p>
                {primaryDistance ? (
                  <p className="text-base text-muted-foreground">
                    <span
                      className={cn(
                        "font-semibold tabular",
                        primaryDistance.delta > 0 && "text-destructive",
                        primaryDistance.delta < 0 && "text-primary"
                      )}
                    >
                      {formatUsdMillions(Math.abs(primaryDistance.delta))}
                    </span>{" "}
                    {primaryDistance.delta > 0
                      ? "over"
                      : primaryDistance.delta < 0
                        ? "under"
                        : "at"}{" "}
                    the {thresholdName(primaryDistance.id)}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="sm:min-w-52 sm:text-right">
              <p className="type-eyebrow">Guaranteed, all future years</p>
              <p className="mt-1 text-2xl font-medium tabular">{formatUsdMillions(remaining)}</p>
              <p className="type-caption mt-1">
                {team.current_contract_season
                  ? `${team.current_contract_season} onward, across remaining contract years`
                  : "Across remaining contract years"}
              </p>
            </div>
          </div>

          {scale && bands.length > 0 ? (
            <div className="relative mt-8 pt-12">
              <span className="absolute left-0 top-0 text-xs tabular text-ink-3">
                {formatUsdMillions(scale.min)}
              </span>
              <span className="absolute right-0 top-0 text-xs tabular text-ink-3">
                {formatUsdMillions(scale.max)}
              </span>
              <div
                role="img"
                aria-label="Team payroll position relative to the luxury tax and apron thresholds"
                className="relative h-11 border border-foreground"
              >
                {bands.map((band, index) => (
                  <div
                    key={`${band.tone}-${index}`}
                    className={cn(
                      "absolute inset-y-0 flex items-center overflow-hidden border-r border-foreground/50",
                      CAP_BAND_CLASS[band.tone]
                    )}
                    style={{
                      left: `${band.start}%`,
                      width: `${band.end - band.start}%`,
                    }}
                  >
                    {chartZones.has(band.tone) && band.end - band.start >= 15 ? (
                      <span
                        className={cn(
                          "truncate px-3 text-xs font-medium",
                          CAP_ZONE_TEXT_CLASS[band.tone]
                        )}
                      >
                        {CAP_ZONE_LABEL[band.tone]}
                      </span>
                    ) : null}
                  </div>
                ))}

                {markers.map((marker) => (
                  <div
                    key={marker.id}
                    className="absolute inset-y-[-0.5rem] z-20"
                    style={{ left: `${marker.pct}%` }}
                  >
                    <span
                      title={`${marker.label} ${formatUsdMillions(marker.value)}`}
                      data-lane={marker.lane}
                      className={cn(
                        "absolute bottom-full left-1/2 -translate-x-1/2 whitespace-nowrap text-xs tabular",
                        marker.lane === 0 ? "mb-1" : "mb-5"
                      )}
                    >
                      {formatUsdMillions(marker.value)}
                    </span>
                    <span className="absolute inset-y-0 left-0 w-px bg-foreground" />
                  </div>
                ))}

                {pinPct != null ? (
                  <div
                    className="absolute inset-y-[-0.5rem] z-30 w-0.5 bg-foreground"
                    style={{ left: `${pinPct}%` }}
                  />
                ) : null}
              </div>

              {pinPct != null && payroll != null ? (
                <div
                  className="absolute top-full z-10 pt-1 text-center"
                  style={{
                    left: `${pinPct}%`,
                    transform:
                      pinPct < 8
                        ? "translateX(0)"
                        : pinPct > 92
                          ? "translateX(-100%)"
                          : "translateX(-50%)",
                  }}
                >
                  <p className="whitespace-nowrap text-sm font-semibold tabular">
                    {formatUsdMillions(payroll)}
                  </p>
                  <p className="type-eyebrow whitespace-nowrap">This team</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {scale ? (
            <p className="type-caption mt-10">
              {payroll != null && payroll < scale.min
                ? `Scale starts at ${formatUsdMillions(scale.min)}. This team's payroll is below the left edge${team.salary_cap != null && team.salary_cap < scale.min ? `; the salary cap (${formatUsdMillions(team.salary_cap)}) is off-scale` : ""}.`
                : team.salary_cap != null && team.salary_cap < scale.min
                  ? `Scale starts at ${formatUsdMillions(scale.min)}. The salary cap (${formatUsdMillions(team.salary_cap)}) sits to the left of this view.`
                  : `Scale runs from ${formatUsdMillions(scale.min)} to ${formatUsdMillions(scale.max)}.`}
            </p>
          ) : null}

          {restrictions.length > 0 ? (
            <div className="mt-6 border-t border-border pt-4">
              <p className="type-eyebrow">What this tier restricts</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {restrictions.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 text-sm">
                    <span
                      className={cn(
                        "mt-0.5 w-3 font-semibold",
                        item.allowed ? "text-primary" : "text-destructive"
                      )}
                      aria-hidden
                    >
                      {item.allowed ? "✓" : "×"}
                    </span>
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-1 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-ink-2">
              {primaryDistance ? (
                <p>
                  {primaryDistance.over
                    ? `To get under the ${thresholdName(primaryDistance.id)}: shed `
                    : primaryDistance.delta < 0
                      ? `Payroll is ${formatUsdMillions(Math.abs(primaryDistance.delta))} under the ${thresholdName(primaryDistance.id)}.`
                      : `Payroll is at the ${thresholdName(primaryDistance.id)}.`}
                  {primaryDistance.over ? (
                    <span className="font-medium tabular text-foreground">
                      {formatUsdMillions(Math.abs(primaryDistance.delta))}
                    </span>
                  ) : null}
                </p>
              ) : null}
              {taxDistance?.over && primaryDistance?.id !== "tax" ? (
                <p>
                  <span aria-hidden="true">· </span>
                  To get under the tax: shed{" "}
                  <span className="font-medium tabular text-foreground">
                    {formatUsdMillions(Math.abs(taxDistance.delta))}
                  </span>
                </p>
              ) : null}
            </div>
            <p className="type-caption sm:max-w-[48%] sm:text-right">
              Thresholds: {team.current_contract_season ?? "current season"} CBA figures. BRef
              payroll may lag signings; this is not a tax bill. Repeater status, exception amounts,
              and some apron rules are not modeled.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
