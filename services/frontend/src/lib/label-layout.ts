/**
 * Places point labels on a chart so they do not overprint each other, the way
 * two MVP candidates with near-identical scores and salaries would.
 *
 * Greedy: labels are placed in the order given (most important first), each at
 * the candidate spot that overlaps least with the labels already placed, the
 * obstacles, and the plot's edge. Beside the dot is preferred, then stepped
 * above and below.
 */

export type LabelRequest = {
  id: string;
  /** The dot's centre, in pixels. */
  x: number;
  y: number;
  text: string;
  /** Distance from the dot's centre to the label's near edge. */
  gap: number;
  fontSize: number;
  /** Bold labels run wider. */
  bold?: boolean;
};

export type PlacedLabel = {
  id: string;
  /** Text anchor point: SVG `x` / `y` for a `<text>` with the given `anchor`. */
  x: number;
  y: number;
  anchor: "start" | "end";
  /** True when the label was moved off the dot's line and needs a leader back to it. */
  leader: boolean;
};

export type Box = { left: number; right: number; top: number; bottom: number };

// SVG text has no layout before paint, so width is estimated from its length.
// These ratios slightly over-estimate the UI face, which errs toward a gap.
const CHAR_WIDTH = 0.6;
const BOLD_CHAR_WIDTH = 0.66;
// Clearance kept between two labels.
const PADDING = 2;

export function estimateTextWidth(text: string, fontSize: number, bold = false) {
  return text.length * fontSize * (bold ? BOLD_CHAR_WIDTH : CHAR_WIDTH);
}

/** Vertical steps tried, in line heights: level first, then alternating outward. */
const STEPS = [0, -1, 1, -2, 2, -3, 3];

function candidates(request: LabelRequest) {
  const lineHeight = request.fontSize + 3;
  return STEPS.flatMap((step) =>
    (["start", "end"] as const).map((anchor) => ({
      anchor,
      x: anchor === "start" ? request.x + request.gap : request.x - request.gap,
      // Baseline sits a third of the font below centre, so a level label is centred on the dot.
      y: request.y + request.fontSize / 3 + step * lineHeight,
      leader: step !== 0,
    }))
  );
}

function boxOf(
  spot: { x: number; y: number; anchor: "start" | "end" },
  width: number,
  fontSize: number
): Box {
  const left = spot.anchor === "start" ? spot.x : spot.x - width;
  return {
    left: left - PADDING,
    right: left + width + PADDING,
    top: spot.y - fontSize - PADDING,
    bottom: spot.y + fontSize * 0.25 + PADDING,
  };
}

function overlapArea(a: Box, b: Box) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

function outsideArea(box: Box, bounds: Box) {
  const area = (box.right - box.left) * (box.bottom - box.top);
  return area - overlapArea(box, bounds);
}

// Printing over another name is worse than over a dot, and leaving the plot worst.
const LABEL_WEIGHT = 4;
const OUTSIDE_WEIGHT = 8;
// A leader costs a little, so a level spot wins a near tie.
const LEADER_COST = 1;

/**
 * `obstacles` are boxes labels should also keep off (dots, fixed annotations),
 * at a lower cost than another label. Each label takes the cheapest spot; a
 * spot that touches nothing costs only its leader, so the first clear one wins.
 */
export function placeLabels(
  requests: LabelRequest[],
  bounds: Box,
  obstacles: Box[] = []
): PlacedLabel[] {
  const labels: Box[] = [];
  return requests.map((request) => {
    const width = estimateTextWidth(request.text, request.fontSize, request.bold);
    let best: { spot: ReturnType<typeof candidates>[number]; box: Box; cost: number } | null = null;
    for (const spot of candidates(request)) {
      const box = boxOf(spot, width, request.fontSize);
      const cost =
        OUTSIDE_WEIGHT * outsideArea(box, bounds) +
        LABEL_WEIGHT * labels.reduce((sum, other) => sum + overlapArea(box, other), 0) +
        obstacles.reduce((sum, other) => sum + overlapArea(box, other), 0) +
        (spot.leader ? LEADER_COST : 0);
      if (best == null || cost < best.cost) best = { spot, box, cost };
      if (cost === 0) break;
    }
    // candidates() is never empty, so `best` is set.
    const chosen = best as NonNullable<typeof best>;
    labels.push(chosen.box);
    return { id: request.id, ...chosen.spot };
  });
}
