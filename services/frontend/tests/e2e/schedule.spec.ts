import { expect, test } from "@playwright/test";

import { API_FAILURE_DETAIL, expectNo2010Range, mockApi } from "./helpers";

test("schedule lists the upcoming slate without scores or 2010-11 copy", async ({ page }) => {
  await mockApi(page);
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(page.getByText(/Scores stay empty until the game is Final/)).toBeVisible();
  await expect(page.getByText("LAL")).toBeVisible();
  await expect(page.getByText("@")).toBeVisible();
  await expect(page.getByText("GSW")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Scheduled" })).toBeVisible();
  await expect(page.getByText("Chase Center")).toBeVisible();
  await expect(page.getByRole("link", { name: "PBP →" })).toHaveCount(0);
  await expectNo2010Range(page);
});

test("schedule empty warehouse", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/schedule");
  await expect(page.getByText("No upcoming games")).toBeVisible();
  await expect(page.getByText(/No scheduled games for .* yet/)).toBeVisible();
  await expect(page.getByText(/scrape-games|then dbt/i)).toHaveCount(0);
});

test("schedule reports its page range and pins both pager buttons on one page", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/schedule");
  await expect(page.getByText("1–1 of 1 games")).toBeVisible();
  await expect(page.getByRole("button", { name: "← Prev" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next →" })).toBeDisabled();
});

test("schedule surfaces the API failure instead of the empty slate copy", async ({ page }) => {
  await mockApi(page, { fail: true });
  await page.goto("/schedule");
  await expect(page.getByText(API_FAILURE_DETAIL)).toBeVisible();
});
