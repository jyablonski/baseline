import { expect, test } from "@playwright/test";

import { API_FAILURE_DETAIL, expectNo2010Range, mockApi, waitForApiCall } from "./helpers";

test("teams directory to profile shows cap position", async ({ page }) => {
  await mockApi(page);
  await page.goto("/teams");
  await expect(page).toHaveTitle("Teams — Baseline");
  await expect(page.getByRole("heading", { name: "Teams" })).toBeVisible();
  await expect(page.getByText(/Records shown for/)).toHaveCount(0);
  await expect(page.getByText(/30 clubs/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "GSW" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Team offensive vs defensive rating" })
  ).toBeVisible();
  await expectNo2010Range(page);

  await page.getByRole("link", { name: "GSW" }).click();
  await expect(page.getByRole("heading", { name: "Golden State Warriors" })).toBeVisible();
  await expect(page.getByText(/Chase Center/)).toBeVisible();
  await expect(page.getByText("Cap position").first()).toBeVisible();
  await expect(page.getByText("Regular Season")).toBeVisible();
  await expect(page.getByText("Arena city")).toBeVisible();
});

test("standings page lists conferences without a 2010-11 range", async ({ page }) => {
  await mockApi(page);
  await page.goto("/standings");
  await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
  await expect(page.getByText("Eastern Conference")).toBeVisible();
  await expect(page.getByText("Western Conference")).toBeVisible();
  await expect(page.getByRole("link", { name: "CHI" })).toBeVisible();
  await expect(page.getByRole("link", { name: "GSW" })).toBeVisible();
  await expectNo2010Range(page);
});

test("teams directory empty warehouse", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/teams");
  await expect(page.getByText("No teams to show yet.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Team offensive vs defensive rating" })
  ).toHaveCount(0);
});

test("teams page plots each team as a bare logo marker", async ({ page }) => {
  await mockApi(page);
  await page.goto("/teams");

  const scatter = page.locator("section[aria-labelledby='team-ratings-heading']");
  await expect(scatter).toBeVisible();
  await expect(scatter.getByText("Offensive rating")).toBeVisible();
  // Markers are the logo image alone; the backing circle was removed.
  await expect(scatter.locator("image")).toHaveCount(3);
  await expect(scatter.locator("circle")).toHaveCount(0);
});

test("team profile filters games by opponent and Reset clears it", async ({ page }) => {
  await mockApi(page);
  await page.goto("/teams/1610612744");
  await expect(page.getByText("Filter games")).toBeVisible();
  // The Since filter was removed; Opponent is now the first control.
  await expect(page.getByText("Since")).toHaveCount(0);

  await page.getByLabel("Opponent").selectOption("1610612738");
  await waitForApiCall(page, "opponent_team_id=1610612738");

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByLabel("Opponent")).toHaveValue("");
});

test("team profile home/away segmented control filters the record", async ({ page }) => {
  await mockApi(page);
  await page.goto("/teams/1610612744");
  await page.getByRole("button", { name: "home", exact: true }).click();
  await waitForApiCall(page, "location=home");

  await page.getByRole("button", { name: "away", exact: true }).click();
  await waitForApiCall(page, "location=away");

  // Back to "all" refetches nothing — that query is already cached from load —
  // so the observable contract is the segment that reads as selected.
  await page.getByRole("button", { name: "all", exact: true }).click();
  await expect(page.getByRole("button", { name: "all", exact: true })).toHaveClass(
    /seg-btn-active/
  );
  await expect(page.getByRole("button", { name: "away", exact: true })).not.toHaveClass(
    /seg-btn-active/
  );
});

test("team profile filters games by arena city", async ({ page }) => {
  await mockApi(page);
  await page.goto("/teams/1610612744");
  await page.getByLabel("Arena city").selectOption("San Francisco");
  await waitForApiCall(page, "arena_city=San");
});

test("teams directory surfaces the API failure instead of an empty grid", async ({ page }) => {
  await mockApi(page, { fail: true });
  await page.goto("/teams");
  await expect(page.getByText(API_FAILURE_DETAIL).first()).toBeVisible();
});

test("standings lists streak and last-ten columns for both conferences", async ({ page }) => {
  await mockApi(page);
  await page.goto("/standings");
  await expect(page.getByRole("columnheader", { name: "Streak" }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "L10" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "W5", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "8-2", exact: true })).toBeVisible();
  await expectNo2010Range(page);
});
