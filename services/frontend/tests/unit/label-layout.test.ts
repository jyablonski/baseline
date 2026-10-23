import { describe, expect, it } from "vitest";

import { estimateTextWidth, type LabelRequest, placeLabels } from "@/lib/label-layout";

const BOUNDS = { left: 0, right: 600, top: 0, bottom: 400 };

function label(id: string, x: number, y: number, text = id): LabelRequest {
  return { id, x, y, text, gap: 9, fontSize: 12 };
}

type Box = { left: number; right: number; top: number; bottom: number };

/** The box a placed label occupies, using the same width estimate as the layout. */
function boxOf(request: LabelRequest, placed: ReturnType<typeof placeLabels>[number]): Box {
  const width = estimateTextWidth(request.text, request.fontSize, request.bold);
  const left = placed.anchor === "start" ? placed.x : placed.x - width;
  return { left, right: left + width, top: placed.y - request.fontSize, bottom: placed.y };
}

function overlap(a: Box, b: Box) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe("estimateTextWidth", () => {
  it("scales with length and size, and runs wider in bold", () => {
    expect(estimateTextWidth("Maxey", 12)).toBeCloseTo(36);
    expect(estimateTextWidth("Maxey", 24)).toBeCloseTo(72);
    expect(estimateTextWidth("Maxey", 12, true)).toBeGreaterThan(estimateTextWidth("Maxey", 12));
  });
});

describe("placeLabels", () => {
  it("puts a lone label level, just right of its dot, with no leader", () => {
    const [placed] = placeLabels([label("a", 100, 100)], BOUNDS);
    expect(placed).toEqual({ id: "a", x: 109, y: 104, anchor: "start", leader: false });
  });

  it("keeps labels in the order given, so the first keeps the best spot", () => {
    const placed = placeLabels([label("first", 100, 100), label("second", 102, 101)], BOUNDS);
    expect(placed.map((spot) => spot.id)).toEqual(["first", "second"]);
    expect(placed[0]).toMatchObject({ anchor: "start", leader: false });
  });

  it("sends a near-twin to the other side of its dot rather than over the first", () => {
    const requests = [label("Gilgeous-Alexander", 300, 100), label("Maxey", 296, 102)];
    const placed = placeLabels(requests, BOUNDS);
    expect(placed[1]).toMatchObject({ anchor: "end", leader: false });
    expect(overlap(boxOf(requests[0], placed[0]), boxOf(requests[1], placed[1]))).toBe(false);
  });

  it("steps a label above or below, with a leader, when both sides are taken", () => {
    const requests = [label("One", 300, 100), label("Two", 300, 100), label("Three", 300, 100)];
    const placed = placeLabels(requests, BOUNDS);
    expect(placed[2].leader).toBe(true);
    expect(placed[2].y).not.toBe(placed[0].y);
    for (let i = 0; i < requests.length; i += 1) {
      for (let j = i + 1; j < requests.length; j += 1) {
        expect(overlap(boxOf(requests[i], placed[i]), boxOf(requests[j], placed[j]))).toBe(false);
      }
    }
  });

  it("flips to the left at the plot's right edge", () => {
    const [placed] = placeLabels([label("Antetokounmpo", 590, 100)], BOUNDS);
    expect(placed.anchor).toBe("end");
    expect(placed.x).toBe(581);
  });

  it("keeps off obstacles such as other dots and fixed annotations", () => {
    const obstacle = { left: 105, right: 200, top: 85, bottom: 115 };
    const [placed] = placeLabels([label("a", 100, 100)], BOUNDS, [obstacle]);
    expect(placed.anchor).toBe("end");
  });

  it("still places every label when the plot is too crowded to clear them all", () => {
    const requests = Array.from({ length: 12 }, (_, index) => label(`P${index}`, 30, 30));
    const placed = placeLabels(requests, { left: 0, right: 60, top: 0, bottom: 60 });
    expect(placed).toHaveLength(12);
    for (const spot of placed) {
      expect(Number.isFinite(spot.x) && Number.isFinite(spot.y)).toBe(true);
    }
  });

  it("prefers overlapping a dot to overlapping another name", () => {
    // Too short a plot to step up or down: left of the dot is another name,
    // right of it only a small dot. The label takes the right.
    const [, placed] = placeLabels(
      [label("Taken", 40, 100), label("Next", 100, 100)],
      { left: 0, right: 600, top: 85, bottom: 112 },
      [{ left: 109, right: 120, top: 95, bottom: 105 }]
    );
    expect(placed).toMatchObject({ anchor: "start", leader: false });
  });
});
