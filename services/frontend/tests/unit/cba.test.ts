import { describe, expect, it } from "vitest";

import {
  capBarBands,
  capDistances,
  capPercent,
  capPositionSummary,
  capRestrictions,
  capScale,
  capTier,
  capTierLabel,
  capTimingNotes,
  formatCapDistance,
  layoutCapBarMarkers,
  resolveCapFlags,
} from "@/lib/cba";

const HAWKS_LINES = {
  luxury_tax: 200_428_000,
  first_apron: 209_015_000,
  second_apron: 221_686_000,
};

describe("CBA apron rules", () => {
  it("resolves the highest apron flag into a tier label", () => {
    expect(capTier({})).toBeNull();
    expect(
      capTier({ over_luxury_tax: false, over_first_apron: false, over_second_apron: false })
    ).toBe(1);
    expect(
      capTier({ over_luxury_tax: true, over_first_apron: false, over_second_apron: false })
    ).toBe(2);
    expect(
      capTier({ over_luxury_tax: true, over_first_apron: true, over_second_apron: false })
    ).toBe(3);
    expect(
      capTier({ over_luxury_tax: true, over_first_apron: true, over_second_apron: true })
    ).toBe(4);
    expect(capTierLabel(1)).toBe("Under tax (tier 1 of 4)");
    expect(capTierLabel(2)).toBe("Over tax (tier 2 of 4)");
    expect(capTierLabel(3)).toBe("Over 1st apron (tier 3 of 4)");
    expect(capTierLabel(4)).toBe("Over 2nd apron (tier 4 of 4)");
  });

  it("derives flags from payroll vs CBA lines when gold flags are empty", () => {
    expect(resolveCapFlags({}, 221_300_000, HAWKS_LINES)).toEqual({
      over_luxury_tax: true,
      over_first_apron: true,
      over_second_apron: false,
    });
    expect(resolveCapFlags({ over_luxury_tax: false }, 221_300_000, HAWKS_LINES)).toMatchObject({
      over_luxury_tax: false,
    });
  });

  it("marks first-apron restrictions without inventing a tax bill", () => {
    const firstApron = capRestrictions(3);
    // First-apron teams keep the taxpayer MLE; only the 2nd apron loses it.
    expect(firstApron.find((row) => row.id === "taxpayer_mle")?.allowed).toBe(true);
    expect(firstApron.find((row) => row.id === "sign_and_trade")?.allowed).toBe(false);
    expect(firstApron.find((row) => row.id === "buyouts")?.allowed).toBe(false);
    expect(firstApron.find((row) => row.id === "aggregation")?.allowed).toBe(true);
    expect(firstApron.find((row) => row.id === "salary_matching")?.allowed).toBe(false);
    expect(firstApron.find((row) => row.id === "future_firsts")?.allowed).toBe(true);

    const secondApron = capRestrictions(4);
    expect(secondApron.find((row) => row.id === "aggregation")?.allowed).toBe(false);
    expect(secondApron.find((row) => row.id === "future_firsts")?.allowed).toBe(false);
    expect(secondApron.find((row) => row.id === "taxpayer_mle")?.allowed).toBe(false);

    const underTax = capRestrictions(1);
    expect(underTax.every((row) => row.allowed)).toBe(true);
  });

  it("formats distances and the Hawks-style summary from payroll vs seeds", () => {
    const rows = capDistances(221_300_000, HAWKS_LINES);
    expect(rows.map((row) => [row.id, formatCapDistance(row.delta)])).toEqual([
      ["tax", "+$20.9M over"],
      ["first", "+$12.3M over"],
      ["second", "-$0.4M under"],
    ]);
    expect(formatCapDistance(0)).toBe("$0M at the line");
    expect(capPositionSummary(221_300_000, HAWKS_LINES)).toBe(
      "Over the tax line and the 1st apron; $0.4M under the 2nd apron."
    );
    expect(capPositionSummary(51_000_000, HAWKS_LINES)).toMatch(/under the tax line/);
    expect(capPositionSummary(222_000_000, HAWKS_LINES)).toBe(
      "Over the tax line, the 1st apron and the 2nd apron."
    );
    expect(
      capPositionSummary(205_000_000, { luxury_tax: 200_428_000, first_apron: 209_015_000 })
    ).toBe("Over the tax line; $4M under the 1st apron.");
    expect(capPositionSummary(51_000_000, {})).toBeNull();
    expect(capPositionSummary(null, HAWKS_LINES)).toBeNull();
    expect(capDistances(null, HAWKS_LINES)).toEqual([]);
  });

  it("builds a payroll bar scale and bands from cap lines", () => {
    const scale = capScale([221_300_000, 164_961_000, ...Object.values(HAWKS_LINES)]);
    expect(scale).not.toBeNull();
    expect(scale && scale.min).toBeLessThan(164_961_000);
    expect(scale && scale.max).toBeGreaterThan(221_686_000);
    expect(capScale([])).toBeNull();
    expect(capScale([100])).toEqual({ min: 90, max: 110 });
    expect(capPercent(50, 0, 100)).toBe(50);
    expect(capPercent(50, 100, 100)).toBe(0);

    const bands = capBarBands(scale!, HAWKS_LINES);
    expect(bands.some((band) => band.tone === "under")).toBe(true);
    expect(bands.some((band) => band.tone === "first")).toBe(true);
    expect(bands.at(-1)?.tone).toBe("second");
  });

  it("staggers close tax/apron labels and keeps wide gaps on one lane", () => {
    const pistonsScale = capScale([153_163_826, 164_961_000, ...Object.values(HAWKS_LINES)]);
    expect(pistonsScale).not.toBeNull();
    const clustered = layoutCapBarMarkers(
      [
        { id: "tax", label: "Tax", value: HAWKS_LINES.luxury_tax },
        { id: "first", label: "1st apron", value: HAWKS_LINES.first_apron },
        { id: "second", label: "2nd apron", value: HAWKS_LINES.second_apron },
      ],
      pistonsScale!
    );
    expect(clustered.map((marker) => marker.id)).toEqual(["tax", "first", "second"]);
    expect(clustered[0].lane).toBe(0);
    expect(clustered[1].lane).toBe(1);
    expect(new Set(clustered.map((marker) => marker.lane)).size).toBe(2);

    const spread = layoutCapBarMarkers(
      [
        { id: "tax", label: "Tax", value: 50 },
        { id: "first", label: "1st apron", value: 150 },
        { id: "second", label: "2nd apron", value: 250 },
      ],
      { min: 0, max: 300 }
    );
    expect(spread.every((marker) => marker.lane === 0)).toBe(true);
    expect(
      layoutCapBarMarkers([{ id: "tax", label: "Tax", value: null }], { min: 0, max: 1 })
    ).toEqual([]);
  });
});

describe("capTimingNotes", () => {
  it("says nothing under the tax", () => {
    expect(capTimingNotes(1, "2026-27")).toEqual([]);
  });

  it("dates the tax bill from the season over the tax", () => {
    expect(capTimingNotes(2, "2026-27")).toEqual([
      { label: "Tax bill", text: "Set by payroll on the regular season's last day (April 2027)." },
    ]);
  });

  it("names the pick a 2nd-apron finish would freeze", () => {
    const notes = capTimingNotes(4, "2026-27");
    expect(notes.map((note) => note.label)).toEqual(["Tax bill", "Apron limits", "Pick freeze"]);
    // 2024-25 froze 2032, so 2026-27 freezes 2034.
    expect(notes[2].text).toBe(
      "Still over the 2nd apron on that day? Their 2034 first-round pick can't be traded."
    );
  });

  it("falls back to undated wording without a season", () => {
    const notes = capTimingNotes(4, null);
    expect(notes[0].text).toBe("Set by payroll on the regular season's last day.");
    expect(notes[2].text).toContain("A first-round pick can't be traded.");
  });
});
