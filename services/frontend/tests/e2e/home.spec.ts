import { expect, test } from "@playwright/test";

import { API_FAILURE_DETAIL, expectNo2010Range, mockApi } from "./helpers";

test("home desk uses latest-season coverage, not a 2010-11 range", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByText("Latest games")).toBeVisible();
  await expect(page.getByText("Standings snapshot")).toBeVisible();
  await expect(page.getByText("Latest completed games this season.")).toHaveCount(0);
  await expect(page.locator("dt:text-is('Coverage:') + dd")).toHaveText("2025-26");
  await expectNo2010Range(page);
  // exact: the "PBP game flow →" link below the games list also contains "PBP".
  await expect(page.getByRole("link", { name: "PBP", exact: true })).toBeVisible();
  await expect(page.getByText("LAL")).toBeVisible();
  await expect(page.getByText("at", { exact: true })).toBeVisible();
  await expect(page.getByText("GSW").first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Regular Season" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Full standings →" })).toBeVisible();
});

test("home empty warehouse shows latest-season empty copy", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/");
  await expect(page.getByText("No games yet for this season.")).toBeVisible();
  await expect(page.getByText("No standings yet")).toBeVisible();
  await expect(page.locator("dt:text-is('Coverage:') + dd")).not.toHaveText(/2010-11/);
  await expectNo2010Range(page);
});

test("home standings snapshot deep-links to /standings", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Full standings →" }).click();
  await expect(page).toHaveURL(/\/standings/);
  await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
  await expect(page.getByText("Eastern Conference")).toBeVisible();
  await expect(page.getByText("Western Conference")).toBeVisible();
  await expectNo2010Range(page);
});

test("home standings snapshot labels its columns and covers both conferences", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");

  const snapshot = page.locator("section").filter({ hasText: "Standings snapshot" }).first();
  await expect(snapshot.getByText("EAST")).toBeVisible();
  await expect(snapshot.getByText("WEST")).toBeVisible();
  // Column headers, not just the trailing caption.
  await expect(snapshot.getByText("W–L", { exact: true })).toHaveCount(2);
  await expect(snapshot.getByText("Win %", { exact: true })).toHaveCount(2);
  await expect(snapshot.getByText("50–32")).toBeVisible();
  await expect(snapshot.getByText(".610")).toBeVisible();
});

test("home coverage strip no longer counts seasons", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByText("Players in directory")).toBeVisible();
  await expect(page.getByText("Seasons", { exact: true })).toHaveCount(0);
});

test("home surfaces the API failure instead of the empty-warehouse copy", async ({ page }) => {
  await mockApi(page, { fail: true });
  await page.goto("/");
  await expect(page.getByText(API_FAILURE_DETAIL).first()).toBeVisible();
});
