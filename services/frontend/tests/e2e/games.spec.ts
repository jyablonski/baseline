import { expect, test } from "@playwright/test";

import { API_FAILURE_DETAIL, expectNo2010Range, mockApi, waitForApiCall } from "./helpers";

test("games index lists recent finals and opens empty play-by-play", async ({ page }) => {
  await mockApi(page);
  await page.goto("/games");
  await expect(page.getByRole("heading", { name: "Game flow" })).toBeVisible();
  await expect(page.getByText("Recent final games")).toBeVisible();
  await expect(page.getByText("Not live win probability.")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Margin" })).toBeVisible();
  // Scoped to the recent-games table: the blown-leads table below also names teams.
  const recent = page.getByRole("table").first();
  await expect(recent.getByText("LAL", { exact: true })).toBeVisible();
  await expect(recent.getByText("GSW", { exact: true })).toBeVisible();
  await expectNo2010Range(page);

  await expect(page.getByRole("heading", { name: "Biggest blown leads" })).toBeVisible();
  const collapses = page.getByRole("table").nth(1);
  await expect(collapses.getByRole("cell", { name: "MIA", exact: true })).toBeVisible();
  await expect(collapses.getByRole("cell", { name: "21", exact: true })).toBeVisible();

  await recent.getByRole("link", { name: "PBP →" }).first().click();
  await expect(page).toHaveURL(/\/games\/0022400001/);
  await expect(page.getByText("No PBP data available.")).toBeVisible();
  await expect(page.getByText("There's no scoring timeline for this game.")).toBeVisible();
  await expect(page.getByRole("link", { name: "All recent final games →" })).toBeVisible();
  await expect(page.getByText("Recent final games", { exact: true })).toHaveCount(0);
});

test("games index empty warehouse", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/games");
  await expect(page.getByText("No completed games to show yet.")).toBeVisible();
});

test("game flow page narrates the comeback and charts the differential", async ({ page }) => {
  await mockApi(page);
  await page.goto("/games/0022400002");

  await expect(page.getByRole("heading", { name: /Miami Heat|MIA/ })).toBeVisible();
  // The badge is the comeback story: deficit erased plus where it stood entering Q4.
  await expect(page.getByText("BOS erased a 21-point deficit, down 9 entering Q4")).toBeVisible();
  await expect(page.getByText("Max lead +21")).toBeVisible();
  await expect(page.getByText("4 lead changes")).toBeVisible();
  await expect(page.getByText("97 plays")).toBeVisible();
  await expect(page.getByText("No PBP data available.")).toHaveCount(0);
});

test("blown-leads table links through to that game", async ({ page }) => {
  await mockApi(page);
  await page.goto("/games");

  const collapses = page.getByRole("table").nth(1);
  await expect(collapses.getByRole("cell", { name: "Q3", exact: true })).toBeVisible();
  await collapses.getByRole("link", { name: "PBP →" }).first().click();
  await expect(page).toHaveURL(/\/games\/0022400002/);
  await expect(page.getByText("BOS erased a 21-point deficit, down 9 entering Q4")).toBeVisible();
});

test("game flow tooltip tints each abbreviation with its side's plot colour", async ({ page }) => {
  await mockApi(page);
  await page.goto("/games/0022400002");
  await expect(page.getByText("Max lead +21")).toBeVisible();

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

test("blown-leads table names the opponent beside the team that collapsed", async ({ page }) => {
  await mockApi(page);
  await page.goto("/games");
  const collapses = page.getByRole("table").nth(1);
  await expect(collapses.getByRole("columnheader", { name: "Opponent" })).toBeVisible();

  const row = collapses.getByRole("row").filter({ hasText: "MIA" });
  await expect(row.getByRole("cell", { name: "MIA", exact: true })).toBeVisible();
  // BOS erased the lead, so it is the opponent on MIA's collapse row.
  await expect(row.getByRole("cell", { name: "BOS", exact: true })).toBeVisible();
});

test("blown-leads filter narrows by the team that blew the lead", async ({ page }) => {
  await mockApi(page);
  await page.goto("/games");
  const collapses = page.getByRole("table").nth(1);
  await expect(collapses.getByRole("cell", { name: "MIA", exact: true })).toBeVisible();

  await page.getByLabel("Blew it").selectOption("MIA");
  await waitForApiCall(page, "blown_lead_team=MIA");
  await expect(collapses.getByRole("cell", { name: "MIA", exact: true })).toBeVisible();

  // BOS came back rather than collapsing, so filtering to it clears the table.
  await page.getByLabel("Blew it").selectOption("BOS");
  await waitForApiCall(page, "blown_lead_team=BOS");
  await expect(page.getByText("No blown leads for BOS yet.")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(1);
});

test("changing the blown-leads filter holds the scroll position", async ({ page }) => {
  // Small viewport plus a full table so the page actually scrolls, and latency
  // so the in-flight state is observable. Unmounting the table mid-fetch
  // collapses document height and the browser clamps scrollTop to the new max.
  await page.setViewportSize({ width: 800, height: 300 });
  await mockApi(page, { delayMs: 400, collapseRows: 10 });
  await page.goto("/games");
  await expect(page.getByRole("table").nth(1)).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);

  await page.getByLabel("Blew it").selectOption("MIA");
  // Sampled while the request is still in flight, which is the moment the
  // table used to disappear.
  await page.waitForTimeout(150);
  // One-shot reads: a web-first assertion would retry until the fetch settled
  // and never see the gap.
  expect(await page.getByRole("table").count()).toBe(2);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);

  await waitForApiCall(page, "blown_lead_team=MIA");
  await expect(page.getByRole("table").nth(1)).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test("game page carries a box score with shooting splits under the chart", async ({ page }) => {
  await mockApi(page);
  await page.goto("/games/0022400002");
  await expect(page.getByRole("heading", { name: "Box score" })).toBeVisible();
  const row = page.getByRole("row", { name: /Kawhi Leonard/ });
  await expect(row.getByText("10-21")).toBeVisible();
  await expect(row.getByText("47.6%")).toBeVisible();
  await expect(row.getByText("57.1%")).toBeVisible();
  await expect(row.getByText("-7")).toBeVisible();
});
