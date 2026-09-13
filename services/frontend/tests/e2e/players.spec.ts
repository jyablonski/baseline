import { expect, test } from "@playwright/test";

import {
  API_FAILURE_DETAIL,
  expectNo2010Range,
  lastApiCall,
  mockApi,
  waitForApiCall,
} from "./helpers";

test("players directory to profile shows remaining-contract snapshot and B2B", async ({ page }) => {
  await mockApi(page);
  await page.goto("/players");
  await expect(page.getByRole("heading", { name: "Players" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kawhi Leonard" }).first()).toBeVisible();
  await expect(page.getByLabel("Active only")).toBeVisible();
  await expectNo2010Range(page);

  await page.getByRole("link", { name: "Kawhi Leonard" }).first().click();
  await expect(page.getByRole("heading", { name: "Kawhi Leonard" })).toBeVisible();
  await expect(page.getByText("Back-to-back splits", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Remaining contract" })).toBeVisible();
  await expect(page.getByText(/Basketball-Reference remaining-year snapshot/)).toBeVisible();
  await expect(page.getByText(/Unmatched names show/)).toHaveCount(0);
});

test("players directory can compare two selected names", async ({ page }) => {
  await mockApi(page);
  await page.goto("/players");
  await page.getByRole("row").filter({ hasText: "Kawhi Leonard" }).getByRole("checkbox").click();
  await page.getByRole("row").filter({ hasText: "Stephen Curry" }).getByRole("checkbox").click();
  await page.getByRole("button", { name: "Compare selected →" }).click();
  await expect(page).toHaveURL(/\/players\/compare/);
  await expect(page.getByRole("link", { name: "Kawhi Leonard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Stephen Curry" })).toBeVisible();
});

test("players directory empty warehouse", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/players");
  await expect(page.getByText("No players yet")).toBeVisible();
});

test("player game log keeps the PBP link in the last column", async ({ page }) => {
  await mockApi(page);
  await page.goto("/players");
  await page.getByRole("link", { name: "Kawhi Leonard" }).first().click();
  await expect(page).toHaveURL(/\/players\//);

  const log = page
    .getByRole("table")
    .filter({ has: page.getByRole("columnheader", { name: "PBP" }) });
  const headers = log.getByRole("columnheader");
  await expect(headers.last()).toHaveText("PBP");
  await expect(headers.first()).toContainText("Date");
});

test("players search debounces into the URL and sends a fuzzy query", async ({ page }) => {
  await mockApi(page);
  await page.goto("/players");
  await expect(page.getByRole("link", { name: "Kawhi Leonard" }).first()).toBeVisible();

  await page.getByPlaceholder("Search players").fill("kawh");
  // The badge only shows for a non-blank query, so it proves the state landed.
  await expect(page.getByText("fuzzy", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/[?&]search=kawh/);
  const searched = await waitForApiCall(page, "search=kawh");
  expect(searched.some((url) => url.includes("/players"))).toBe(true);
});

test("players active-only toggle drops the active filter from the request", async ({ page }) => {
  await mockApi(page);
  await page.goto("/players");
  // Checked by default, so the first request already narrows to active players.
  await waitForApiCall(page, "active=true");
  await expect(page.getByLabel("Active only")).toBeChecked();

  await page.getByLabel("Active only").click();
  await expect(page.getByLabel("Active only")).not.toBeChecked();
  await expect
    .poll(async () => (await lastApiCall(page, "/players?"))?.includes("active=true"))
    .toBe(false);
});

test("players team filter narrows the request to one team", async ({ page }) => {
  await mockApi(page);
  await page.goto("/players");
  await expect(page.getByRole("link", { name: "Stephen Curry" }).first()).toBeVisible();

  await page.getByRole("combobox").selectOption("1610612744");
  const filtered = await waitForApiCall(page, "team_id=1610612744");
  expect(filtered.some((url) => url.includes("/players"))).toBe(true);
});

test("players pagination reports the match range and pins Prev on page one", async ({ page }) => {
  await mockApi(page);
  await page.goto("/players");
  await expect(page.getByText("1–2 of 2 matches")).toBeVisible();
  // Both buttons are dead ends on a single page of results.
  await expect(page.getByRole("button", { name: "← Prev" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next →" })).toBeDisabled();
});

test("players directory ranks by MVP by default and can sort by name", async ({ page }) => {
  await mockApi(page);
  await page.goto("/players");
  await waitForApiCall(page, "sort=mvp");
  await expect(page.getByRole("columnheader", { name: "MVP" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Stephen Curry" })).toContainText("24.9");

  await page
    .getByRole("group", { name: "Sort players" })
    .getByRole("button", { name: "Name" })
    .click();
  await waitForApiCall(page, "sort=name");
});

test("players directory surfaces the API failure instead of an empty table", async ({ page }) => {
  await mockApi(page, { fail: true });
  await page.goto("/players");
  await expect(page.getByText(API_FAILURE_DETAIL)).toBeVisible();
  await expect(page.getByText("No players yet")).toHaveCount(0);
});
