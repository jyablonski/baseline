import { expect, type Locator, type Page, test } from "@playwright/test";

import { mockApi, mockPlayByPlay } from "./helpers";

// The mocked game 0022400002 is MIA (away) at BOS (home).
const GAME = "/games/0022400002";

type Play = { t: number; home?: number; away?: number };

/** Scoring plays from per-play points, with real clocks derived from elapsed time. */
function plays(list: Play[]) {
  let scoreHome = 0;
  let scoreAway = 0;
  return list.map((play, index) => {
    scoreHome += play.home ?? 0;
    scoreAway += play.away ?? 0;
    const period = Math.min(Math.floor(play.t / 720) + 1, 4);
    const remaining = period * 720 - play.t;
    return {
      game_id: "0022400002",
      action_number: index + 1,
      period,
      clock: `PT${Math.floor(remaining / 60)}M${String(remaining % 60).padStart(2, "0")}.00S`,
      elapsed_seconds: play.t,
      score_home: scoreHome,
      score_away: scoreAway,
      score_differential: scoreHome - scoreAway,
      scoring_side: (play.home ?? 0) > 0 ? "home" : (play.away ?? 0) > 0 ? "away" : null,
      description: `Play ${index + 1}`,
    };
  });
}

// BOS climbs to +4 at 10:04, then MIA answers 17–4 to lead by 9 at 6:17.
const SWING = plays([
  { t: 30, home: 2 },
  { t: 60, away: 2 },
  { t: 90, home: 2 },
  { t: 116, home: 2 },
  { t: 140, away: 3 },
  { t: 170, home: 2 },
  { t: 200, away: 2 },
  { t: 240, away: 2 },
  { t: 280, home: 2 },
  { t: 300, away: 3 },
  { t: 315, away: 2 },
  { t: 330, away: 3 },
  { t: 343, away: 2 },
  { t: 500, home: 2 },
  { t: 900, away: 2 },
  { t: 1500, home: 3 },
  { t: 2200, away: 2 },
  { t: 2870, home: 2 },
]);
const RUN_PLAYS = 9;

async function openGame(page: Page, events: unknown[]) {
  await mockApi(page);
  await mockPlayByPlay(page, events);
  await page.goto(GAME);
  const chart = page.locator(".recharts-surface").first();
  await expect(chart).toBeVisible();
  // Mouse moves only land on what is in the viewport.
  await chart.scrollIntoViewIfNeeded();
  return chart;
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  if (!result) throw new Error("element has no box");
  return result;
}

test("draws the biggest run on the line with its bracket and label under the axis", async ({
  page,
}) => {
  const chart = await openGame(page, SWING);

  await expect(page.getByTestId("flow-facts")).toContainText("Biggest run MIA 17–4");
  await expect(page.getByTestId("flow-legend")).toHaveText(/MIA scores\s*BOS scores/);

  // Leads read as a side and a size, never a negative number.
  await expect(chart.getByText("BOS ahead")).toBeVisible();
  await expect(chart.getByText("MIA ahead")).toBeVisible();
  await expect(chart.locator(".recharts-yAxis-tick-labels text")).toHaveText([
    "+10",
    "+5",
    "0",
    "+5",
    "+10",
  ]);

  // Rings at both ends of the run, labelled with the lead there.
  await expect(chart.locator(".recharts-reference-dot")).toHaveCount(2);
  await expect(chart.getByText("BOS +4", { exact: true })).toBeVisible();
  await expect(chart.getByText("MIA +9", { exact: true })).toBeVisible();

  const marks = page.getByTestId("run-marks");
  await expect(marks).toContainText("MIA 17–4 run · Q1 10:04–6:17 · 13-pt swing");
  // The header and the chart name the same run.
  const title = await marks.locator("tspan").textContent();
  expect(title).toBe("MIA 17–4 run");

  // Lane order, top to bottom: axis line, quarter labels, bracket, label.
  const axis = await box(chart.locator(".recharts-xAxis .recharts-cartesian-axis-line"));
  const quarterLabel = await box(chart.locator(".recharts-xAxis-tick-labels text").first());
  const bracket = await box(marks.locator("path"));
  const label = await box(marks.locator("text"));
  expect(quarterLabel.y).toBeGreaterThanOrEqual(axis.y);
  expect(bracket.y).toBeGreaterThan(quarterLabel.y + quarterLabel.height - 1);
  expect(label.y).toBeGreaterThan(bracket.y + bracket.height - 1);

  // The bracket and both guides line up with the rings, in the SVG's own coordinates.
  const ringXs = await chart
    .locator(".recharts-reference-dot circle")
    .evaluateAll((circles) => circles.map((circle) => Number(circle.getAttribute("cx"))));
  const bracketPath = (await marks.locator("path").getAttribute("d")) ?? "";
  const [, bracketStart, bracketEnd] = bracketPath.match(/^M([\d.]+),.*H([\d.]+)/) ?? [];
  expect(Number(bracketStart)).toBeCloseTo(ringXs[0], 3);
  expect(Number(bracketEnd)).toBeCloseTo(ringXs[1], 3);

  // Dashed guides drop from each ring to the axis.
  const guides = marks.locator("line");
  await expect(guides).toHaveCount(2);
  const axisY = Number(
    await chart.locator(".recharts-xAxis .recharts-cartesian-axis-line").getAttribute("y1")
  );
  const guideEnds = await guides.evaluateAll((lines) =>
    lines.map((line) => ({
      x: Number(line.getAttribute("x1")),
      y2: Number(line.getAttribute("y2")),
      dash: line.getAttribute("stroke-dasharray"),
    }))
  );
  expect(guideEnds.map((guide) => guide.x)).toEqual(ringXs);
  for (const guide of guideEnds) {
    expect(guide.y2).toBe(axisY);
    expect(guide.dash).toBe("3 3");
  }

  // Label and bracket stay inside the chart.
  const surface = await box(chart);
  expect(label.x).toBeGreaterThanOrEqual(surface.x);
  expect(label.x + label.width).toBeLessThanOrEqual(surface.x + surface.width);
  expect(label.y + label.height).toBeLessThanOrEqual(surface.y + surface.height);
});

test("hovering the run lists its plays; hovering outside it does not", async ({ page }) => {
  const chart = await openGame(page, SWING);
  const rings = chart.locator(".recharts-reference-dot circle");
  const tooltip = page.locator(".recharts-default-tooltip");
  const runPlays = page.getByTestId("run-plays");

  // The run's last play: the whole run, with the hovered play in bold.
  const end = await box(rings.nth(1));
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await expect(runPlays).toBeVisible();
  await expect(runPlays).toContainText("MIA 17–4 run Q1 10:04–6:17 · 13-pt swing");
  const rows = runPlays.locator("p").filter({ hasText: /^Q1 · / });
  await expect(rows).toHaveCount(RUN_PLAYS);
  await expect(rows.last()).toContainText("Q1 · 6:17 · Play 13 · MIA 19–BOS 10");
  await expect(rows.last()).toHaveCSS("font-weight", "600");
  await expect(rows.first()).toHaveCSS("font-weight", "400");

  // The play the run starts from is not part of it.
  const start = await box(rings.nth(0));
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await expect(tooltip).toContainText("Q1 · 10:04");
  await expect(runPlays).toHaveCount(0);

  // A play well after the run.
  const surface = await box(chart);
  await page.mouse.move(surface.x + surface.width * 0.8, surface.y + surface.height / 3);
  await expect(tooltip).toBeVisible();
  await expect(runPlays).toHaveCount(0);
});

test("a run across a quarter break names both quarters", async ({ page }) => {
  await openGame(
    page,
    plays([
      { t: 600, home: 2 },
      { t: 690, away: 3 },
      { t: 710, away: 2 },
      { t: 740, away: 3 },
      { t: 760, away: 2 },
      { t: 900, home: 2 },
      { t: 2000, away: 1 },
      { t: 2870, home: 2 },
    ])
  );
  await expect(page.getByTestId("run-marks")).toContainText(
    "MIA 10–0 run · Q1 2:00–Q2 11:20 · 10-pt swing"
  );
});

test("a game without a run draws no run marks", async ({ page }) => {
  const chart = await openGame(page, plays([{ t: 0 }, { t: 2870 }]));
  await expect(page.getByTestId("flow-facts")).toBeVisible();
  await expect(page.getByTestId("flow-facts")).not.toContainText("Biggest run");
  await expect(page.getByTestId("run-marks")).toHaveCount(0);
  await expect(chart.locator(".recharts-reference-dot")).toHaveCount(0);
  await expect(chart.getByText("BOS ahead")).toBeVisible();
});

test("on a phone the chart and its run label stay on screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const chart = await openGame(page, SWING);
  const label = await box(page.getByTestId("run-marks").locator("text"));
  const surface = await box(chart);
  expect(surface.x).toBeGreaterThanOrEqual(0);
  expect(surface.x + surface.width).toBeLessThanOrEqual(390);
  expect(label.x).toBeGreaterThanOrEqual(surface.x);
  expect(label.x + label.width).toBeLessThanOrEqual(surface.x + surface.width);
});
