/**
 * 2023 NBA CBA apron overlay for Baseline cap position.
 *
 * Keyed off the same flags gold writes on `fct_team_payroll` / `dim_teams`
 * (`over_luxury_tax`, `over_first_apron`, `over_second_apron`) versus seed
 * `nba_cba_caps`. This is a documented rule table, not a warehouse fact and
 * not a tax bill.
 *
 * Current (what the UI asserts):
 * - Tier from those three flags (highest flag wins if they disagree).
 * - Binary allowed/restricted for the taxpayer MLE, sign-and-trade,
 *   signing bought-out players paid over the non-taxpayer MLE, aggregation,
 *   taking back more salary than sent, and trading the first-round pick
 *   seven drafts out.
 *
 * Planned / not modeled: repeater tax, BAE dollar amounts, cash-in-trade
 * limits, TPE generation, frozen-pick calendars, exception dollar values.
 *
 * Sources: 2023 NBA CBA 101; league apron FAQ. First-apron teams cannot
 * take back more salary than they send (100% match) but keep the taxpayer
 * MLE (using it hard-caps them at the second apron). Second-apron teams
 * lose the MLE entirely and aggregation, and cannot trade their first-round
 * pick seven drafts out; other future firsts stay tradable.
 */

import { formatUsdMillions } from "@/lib/format";

export type CapFlags = {
  over_luxury_tax?: boolean | null;
  over_first_apron?: boolean | null;
  over_second_apron?: boolean | null;
};

export type CapTier = 1 | 2 | 3 | 4;

export type CapRestrictionId =
  | "taxpayer_mle"
  | "sign_and_trade"
  | "buyouts"
  | "aggregation"
  | "salary_matching"
  | "future_firsts";

export type CapRestriction = {
  id: CapRestrictionId;
  label: string;
  allowed: boolean;
};

export const CAP_RESTRICTIONS: { id: CapRestrictionId; label: string }[] = [
  { id: "taxpayer_mle", label: "Taxpayer mid-level exception" },
  { id: "sign_and_trade", label: "Sign-and-trade acquisitions" },
  { id: "buyouts", label: "Buyout signings over the mid-level" },
  { id: "aggregation", label: "Aggregating salaries in trade" },
  { id: "salary_matching", label: "Taking back more salary than sent" },
  { id: "future_firsts", label: "Trading the first-round pick 7 drafts out" },
];

const ALLOWED_BY_TIER: Record<CapTier, Record<CapRestrictionId, boolean>> = {
  1: {
    taxpayer_mle: true,
    sign_and_trade: true,
    buyouts: true,
    aggregation: true,
    salary_matching: true,
    future_firsts: true,
  },
  2: {
    taxpayer_mle: true,
    sign_and_trade: true,
    buyouts: true,
    aggregation: true,
    salary_matching: true,
    future_firsts: true,
  },
  3: {
    taxpayer_mle: true,
    sign_and_trade: false,
    buyouts: false,
    aggregation: true,
    salary_matching: false,
    future_firsts: true,
  },
  4: {
    taxpayer_mle: false,
    sign_and_trade: false,
    buyouts: false,
    aggregation: false,
    salary_matching: false,
    future_firsts: false,
  },
};

export function resolveCapFlags(
  flags: CapFlags,
  payroll?: number | null,
  lines?: {
    luxury_tax?: number | null;
    first_apron?: number | null;
    second_apron?: number | null;
  }
): CapFlags {
  const derive = (flag: boolean | null | undefined, line?: number | null) => {
    if (flag != null) return flag;
    if (payroll == null || line == null) return null;
    return payroll > line;
  };
  return {
    over_luxury_tax: derive(flags.over_luxury_tax, lines?.luxury_tax),
    over_first_apron: derive(flags.over_first_apron, lines?.first_apron),
    over_second_apron: derive(flags.over_second_apron, lines?.second_apron),
  };
}

export function capTier(flags: CapFlags): CapTier | null {
  if (
    flags.over_luxury_tax == null &&
    flags.over_first_apron == null &&
    flags.over_second_apron == null
  ) {
    return null;
  }
  if (flags.over_second_apron) return 4;
  if (flags.over_first_apron) return 3;
  if (flags.over_luxury_tax) return 2;
  return 1;
}

export function capTierLabel(tier: CapTier): string {
  switch (tier) {
    case 1:
      return "Under tax (tier 1 of 4)";
    case 2:
      return "Over tax (tier 2 of 4)";
    case 3:
      return "Over 1st apron (tier 3 of 4)";
    case 4:
      return "Over 2nd apron (tier 4 of 4)";
  }
}

export function capRestrictions(tier: CapTier): CapRestriction[] {
  return CAP_RESTRICTIONS.map((item) => ({
    ...item,
    allowed: ALLOWED_BY_TIER[tier][item.id],
  }));
}

export type CapDistance = {
  id: "tax" | "first" | "second";
  label: string;
  line: number;
  delta: number;
  over: boolean;
};

export function capDistances(
  payroll: number | null | undefined,
  lines: {
    luxury_tax?: number | null;
    first_apron?: number | null;
    second_apron?: number | null;
  }
): CapDistance[] {
  if (payroll == null || Number.isNaN(payroll)) return [];
  return (
    [
      { id: "tax" as const, label: "Luxury tax", line: lines.luxury_tax },
      { id: "first" as const, label: "1st apron", line: lines.first_apron },
      { id: "second" as const, label: "2nd apron", line: lines.second_apron },
    ] as const
  )
    .filter(
      (row): row is typeof row & { line: number } => row.line != null && !Number.isNaN(row.line)
    )
    .map((row) => ({
      id: row.id,
      label: row.label,
      line: row.line,
      delta: payroll - row.line,
      over: payroll > row.line,
    }));
}

export function formatCapDistance(delta: number): string {
  const magnitude = formatUsdMillions(Math.abs(delta));
  if (delta > 0) return `+${magnitude} over`;
  if (delta < 0) return `-${magnitude} under`;
  return `${magnitude} at the line`;
}

export function capPositionSummary(
  payroll: number | null | undefined,
  lines: {
    luxury_tax?: number | null;
    first_apron?: number | null;
    second_apron?: number | null;
  }
): string | null {
  if (payroll == null || Number.isNaN(payroll)) return null;
  const overTax = lines.luxury_tax != null && payroll > lines.luxury_tax;
  const overFirst = lines.first_apron != null && payroll > lines.first_apron;
  const overSecond = lines.second_apron != null && payroll > lines.second_apron;

  const overs: string[] = [];
  if (overTax) overs.push("the tax line");
  if (overFirst) overs.push("the 1st apron");
  if (overSecond) overs.push("the 2nd apron");

  if (overs.length === 0) {
    if (lines.luxury_tax != null) {
      return `${formatUsdMillions(lines.luxury_tax - payroll)} under the tax line.`;
    }
    return null;
  }

  const overPhrase =
    overs.length === 1
      ? `Over ${overs[0]}`
      : `Over ${overs.slice(0, -1).join(", ")} and ${overs[overs.length - 1]}`;

  if (!overSecond && lines.second_apron != null) {
    return `${overPhrase}; ${formatUsdMillions(lines.second_apron - payroll)} under the 2nd apron.`;
  }
  if (!overFirst && lines.first_apron != null) {
    return `${overPhrase}; ${formatUsdMillions(lines.first_apron - payroll)} under the 1st apron.`;
  }
  return `${overPhrase}.`;
}

export type CapBandTone = "under" | "tax" | "first" | "second";

export type CapBand = {
  key: CapBandTone;
  start: number;
  end: number;
  tone: CapBandTone;
};

export function capScale(
  values: Array<number | null | undefined>
): { min: number; max: number } | null {
  const present = values.filter((value): value is number => value != null && !Number.isNaN(value));
  if (present.length === 0) return null;
  const min = Math.min(...present);
  const max = Math.max(...present);
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    return { min: min - pad, max: max + pad };
  }
  return { min: min * 0.85, max: max * 1.04 };
}

export function capPercent(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

/** Percent gap below which adjacent cap-bar labels stagger onto a second lane. */
export const CAP_MARKER_MIN_GAP_PCT = 14;

export type CapBarMarkerId = "tax" | "first" | "second";

export type CapBarMarker = {
  id: CapBarMarkerId;
  label: string;
  value: number;
  pct: number;
  lane: 0 | 1;
};

export function layoutCapBarMarkers(
  markers: Array<{ id: CapBarMarkerId; label: string; value: number | null | undefined }>,
  scale: { min: number; max: number },
  minGapPct = CAP_MARKER_MIN_GAP_PCT
): CapBarMarker[] {
  const placed: CapBarMarker[] = markers
    .filter(
      (marker): marker is { id: CapBarMarkerId; label: string; value: number } =>
        marker.value != null && !Number.isNaN(marker.value)
    )
    .map((marker) => ({
      id: marker.id,
      label: marker.label,
      value: marker.value,
      pct: capPercent(marker.value, scale.min, scale.max),
      // `as const` keeps this 0 rather than widening to number, which would not
      // satisfy CapBarMarker["lane"]. The loop below still reassigns it to 1.
      lane: 0 as const,
    }))
    .sort((left, right) => left.pct - right.pct || left.label.localeCompare(right.label));

  for (let index = 1; index < placed.length; index += 1) {
    const previous = placed[index - 1];
    const current = placed[index];
    if (current.pct - previous.pct < minGapPct) {
      current.lane = previous.lane === 0 ? 1 : 0;
    }
  }
  return placed;
}

function toneAt(
  value: number,
  lines: {
    luxury_tax?: number | null;
    first_apron?: number | null;
    second_apron?: number | null;
  }
): CapBandTone {
  if (lines.second_apron != null && value >= lines.second_apron) return "second";
  if (lines.first_apron != null && value >= lines.first_apron) return "first";
  if (lines.luxury_tax != null && value >= lines.luxury_tax) return "tax";
  return "under";
}

export function capBarBands(
  scale: { min: number; max: number },
  lines: {
    luxury_tax?: number | null;
    first_apron?: number | null;
    second_apron?: number | null;
  }
): CapBand[] {
  const points = [
    scale.min,
    lines.luxury_tax,
    lines.first_apron,
    lines.second_apron,
    scale.max,
  ].filter((value): value is number => value != null && !Number.isNaN(value));
  const unique = [...new Set(points)].sort((a, b) => a - b);
  const bands: CapBand[] = [];
  for (let index = 0; index < unique.length - 1; index += 1) {
    const startValue = unique[index];
    const endValue = unique[index + 1];
    const start = capPercent(startValue, scale.min, scale.max);
    const end = capPercent(endValue, scale.min, scale.max);
    if (end <= start) continue;
    const tone = toneAt(startValue, lines);
    bands.push({ key: tone, start, end, tone });
  }
  return bands;
}

export const CAP_BAND_CLASS: Record<CapBandTone, string> = {
  under: "bg-accent-soft",
  tax: "bg-tint",
  first: "bg-loss-bar",
  second: "bg-destructive",
};

/**
 * When a tier's costs actually land, for the tier's own rules only. The tax
 * bill and the 2nd-apron pick freeze are judged on payroll at the end of the
 * regular season; apron limits bite on each transaction made while over.
 * The frozen pick is the first-rounder seven drafts after the season ends
 * (2024-25 froze 2032).
 */
export function capTimingNotes(
  tier: CapTier,
  season: string | null | undefined
): { label: string; text: string }[] {
  const startYear = Number.parseInt(season ?? "", 10);
  const endYear = Number.isFinite(startYear) ? startYear + 1 : null;
  const seasonEnd = endYear
    ? `the regular season's last day (April ${endYear})`
    : "the regular season's last day";
  const notes: { label: string; text: string }[] = [];
  if (tier >= 2) {
    notes.push({ label: "Tax bill", text: `Set by payroll on ${seasonEnd}.` });
  }
  if (tier >= 3) {
    notes.push({ label: "Apron limits", text: "Apply now, to every trade and signing." });
  }
  if (tier === 4) {
    const pick = endYear ? `their ${endYear + 7} first-round pick` : "a first-round pick";
    notes.push({
      label: "Pick freeze",
      text: `Still over the 2nd apron on that day? ${pick[0].toUpperCase()}${pick.slice(1)} can't be traded.`,
    });
  }
  return notes;
}
