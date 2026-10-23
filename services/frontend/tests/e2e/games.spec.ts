import { expect, test } from "@playwright/test";

import { API_FAILURE_DETAIL, expectNo2010Range, mockApi, waitForApiCall } from "./helpers";

test("games index opens on the latest day and steps between game days", async ({ page }) => {
  await mockApi(page);
  await page.goto("/games");
  await expect(page.getByRole("heading", { name: "Games", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Latest · Tuesday, October 22" })).toBeVisible();
  // Scoped to the results: the notables below also name teams.
  const results = page.getByRole("region", { name: "Results" });
  await expect(results.getByTestId("result-row")).not.toContainText("GSW by 10");
  await expect(page.getByRole("button", { name: "Later game day" })).toBeDisabled();
  await expectNo2010Range(page);

  await page.getByRole("button", { name: "Earlier game day" }).click();
  await expect(page).toHaveURL(/\/games\?date=2024-10-20/);
  await expect(page.getByRole("heading", { name: "Sunday, October 20" })).toBeVisible();
  await expect(results.getByTestId("result-row")).toContainText("Celtics erase a 21-point deficit");

  // The picker jumps straight back to the latest day.
  await page.getByRole("button", { name: /Pick a game day/ }).click();
  await expect(page.getByRole("button", { name: "Mon, Oct 21, no games" })).toBeDisabled();
  await page.getByRole("button", { name: "Latest" }).click();
  await expect(page).toHaveURL(/\/games$/);

  await expect(page.getByRole("heading", { name: "Season notables" })).toBeVisible();
  await expect(
    page.getByTestId("notable-row").getByRole("link", { name: "BOS beat MIA, 118–115" })
  ).toBeVisible();

  await results.getByTestId("result-row").getByRole("link").click();
  await expect(page).toHaveURL(/\/games\/0022400001/);
  await expect(page.getByText("No PBP data available.")).toBeVisible();
  await expect(page.getByText("There's no scoring timeline for this game.")).toBeVisible();
  await expect(page.getByRole("link", { name: "All results →" })).toBeVisible();
});

test("games index empty warehouse", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/games");
  await expect(page.getByText("No completed games to show yet.")).toBeVisible();
});

test("game flow page narrates the comeback and charts the differential", async ({ page }) => {
  await mockApi(page);
  await page.goto("/games/0022400002");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Miami Heat|MIA/);
  // The turning point is the comeback story: the deficit and where it stood entering Q4.
  await expect(page.getByTestId("recap-card").filter({ hasText: "Turning point" })).toContainText(
    "after trailing by 9 entering Q4 and by 21 in Q3"
  );
  const facts = page.getByTestId("flow-facts");
  await expect(facts).toContainText("MIA led 74%");
  await expect(facts).toContainText("Max lead MIA +21");
  await expect(facts).toContainText("Lead changes 4");
  await expect(facts).toContainText("Ties 3");
  await expect(page.getByText("No PBP data available.")).toHaveCount(0);
});

test("a notable row links through to that game", async ({ page }) => {
  await mockApi(page);
  await page.goto("/games");

  const row = page.getByTestId("notable-row");
  await expect(row).toContainText("trailed by 21 in Q3");
  await row.getByRole("link", { name: "BOS beat MIA, 118–115" }).click();
  await expect(page).toHaveURL(/\/games\/0022400002/);
  await expect(page.getByText(/trailing by 9 entering Q4 and by 21 in Q3/)).toBeVisible();
});

test("game flow tooltip tints each abbreviation with its side's plot colour", async ({ page }) => {
  await mockApi(page);
  await page.goto("/games/0022400002");
  await expect(page.getByTestId("flow-facts")).toBeVisible();

  // Recharts only mounts the tooltip once the pointer is inside the plot area.
  const surface = page.locator(".recharts-surface").first();
  await surface.hover({ position: { x: 240, y: 160 } });
  const value = page.locator(".recharts-tooltip-item-value").first();
  await expect(value).toBeVisible();
  await expect(value).toContainText("MIA");
  await expect(value).toContainText("BOS");
  // This flow carries no team colours, so both fall back to the plot defaults.
  await expect(value.getByText("MIA", { exact: true })).toHaveCSS("color", "rgb(140, 74, 47)");
  await expect(value.getByText("BOS", { exact: true })).toHaveCSS("color", "rgb(45, 90, 39)");
});

test("game flow surfaces the API failure instead of the no-play-by-play copy", async ({ page }) => {
  await mockApi(page, { fail: true });
  await page.goto("/games/0022400002");
  await expect(page.getByText(API_FAILURE_DETAIL).first()).toBeVisible();
});

test("notables switch tabs and filter by either side of a game", async ({ page }) => {
  await mockApi(page);
  await page.goto("/games");
  const notables = page.getByRole("region", { name: "Season notables" });
  await expect(notables.getByRole("link", { name: "BOS beat MIA, 118–115" })).toBeVisible();

  // MIA blew it, so its view reads from the losing side.
  await notables.getByLabel("Team").selectOption("MIA");
  await waitForApiCall(page, "team=MIA");
  await expect(page).toHaveURL(/\/games\?team=MIA/);
  await expect(notables.getByRole("link", { name: "MIA lost to BOS, 115–118" })).toBeVisible();
  await expect(notables.getByText("Blew it")).toBeVisible();

  await notables.getByRole("link", { name: "Closest games" }).click();
  await expect(page).toHaveURL(/tab=closest/);
  await expect(notables.getByRole("columnheader", { name: "Lead changes" })).toBeVisible();
  await expect(notables.getByRole("link", { name: "MIA lost to BOS, 115–118" })).toBeVisible();

  await notables.getByRole("link", { name: "Largest margins" }).click();
  await expect(page).toHaveURL(/tab=margins/);
  await expect(notables.getByTestId("notable-row")).toContainText("never trailed");

  await notables.getByRole("link", { name: "Upsets" }).click();
  await expect(page).toHaveURL(/tab=upsets/);
  await notables.getByLabel("Team").selectOption("");
  await expect(notables.getByRole("link", { name: "GSW won vs LAL, 120–110" })).toBeVisible();
  await expect(notables.getByText("1 in 3")).toBeVisible();
});

test("changing the notables team holds the scroll position", async ({ page }) => {
  // Small viewport plus a full table so the page actually scrolls, and latency
  // so the in-flight state is observable. Unmounting the table mid-fetch
  // collapses document height and the browser clamps scrollTop to the new max.
  await page.setViewportSize({ width: 800, height: 300 });
  await mockApi(page, { delayMs: 400, collapseRows: 10 });
  await page.goto("/games");
  const table = page.getByTestId("notables-table");
  await expect(table).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);

  await page.getByLabel("Team").selectOption("MIA");
  // Sampled while the request is still in flight, which is the moment the
  // table used to disappear.
  await page.waitForTimeout(150);
  // One-shot reads: a web-first assertion would retry until the fetch settled
  // and never see the gap.
  expect(await table.count()).toBe(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);

  await waitForApiCall(page, "team=MIA");
  await expect(table).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test("game page carries a box score with shooting splits under the chart", async ({ page }) => {
  await mockApi(page);
  await page.goto("/games/0022400002");
  await expect(page.getByRole("heading", { name: "Box score" })).toBeVisible();
  await page.getByRole("button", { name: "Shooting %" }).click();
  const row = page.getByRole("row", { name: /Kawhi Leonard/ });
  await expect(row.getByText("10-21")).toBeVisible();
  await expect(row.getByText("47.6%")).toBeVisible();
  await expect(row.getByText("57.1%")).toBeVisible();
  await expect(row.getByText("-7")).toBeVisible();
});

test("game page previews an upcoming game from its schedule row", async ({ page }) => {
  // /schedule asks from today's Eastern date, so pin before the fixtures' Oct 22 slate.
  await page.clock.setFixedTime(new Date("2026-10-20T16:00:00Z"));
  await mockApi(page);
  await page.goto("/schedule");
  await page.locator('a[href="/games/0022500999"]').click();
  await expect(page).toHaveURL(/\/games\/0022500999/);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Los Angeles Lakers @ Golden State Warriors"
  );
  await expect(page.getByRole("heading", { name: "Who wins?" })).toBeVisible();
  const [lal, gsw] = await page.getByTestId("pick-card").all();
  await expect(lal).toContainText("+130");
  await expect(gsw).toContainText("−150");
  await expect(page.getByRole("heading", { name: "Before tip-off" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Season series" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Game flow" })).toHaveCount(0);
});

test("game page recaps a final with the model's call and no regular-season headline", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/games/0022400002");
  await expect(page.getByTestId("recap-card").first()).toBeVisible();
  // A regular-season result needs no headline: the scoreboard already says it.
  await expect(page.getByTestId("recap-headline")).toHaveCount(0);
  await expect(page.getByTestId("recap-call").filter({ hasText: "Model" })).toHaveText(
    "Model favored BOS 55%"
  );
  await page.getByRole("button", { name: /Before tip-off/ }).click();
  await expect(
    page.getByTestId("pregame-row").filter({ hasText: "Model" }).getByText("Called it")
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who wins?" })).toHaveCount(0);
});

test("schedule flags a notable absence and the game page lists the report", async ({ page }) => {
  // /schedule asks from today's Eastern date, so pin before the fixtures' Oct 22 slate.
  await page.clock.setFixedTime(new Date("2026-10-20T16:00:00Z"));
  await mockApi(page);
  await page.goto("/schedule");
  await expect(page.getByTestId("notable-out")).toHaveText("GSW: Stephen Curry out");

  await page.goto("/games/0022500999");
  const report = page.getByTestId("injury-report");
  await expect(report).toContainText("1 listed");
  await report.getByText("Injury report", { exact: true }).click();
  await expect(page.getByTestId("injury-row")).toContainText("Out · Ankle");
  await expect(page.getByTestId("injuries-away")).toContainText("Nobody listed.");
});
