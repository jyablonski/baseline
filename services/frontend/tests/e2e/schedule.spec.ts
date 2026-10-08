import { expect, test } from "@playwright/test";

import { API_FAILURE_DETAIL, expectNo2010Range, mockApi } from "./helpers";

test("schedule lists the upcoming slate without scores or 2010-11 copy", async ({ page }) => {
  await mockApi(page);
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  const scheduleDescription = page
    .locator("p")
    .filter({ hasText: "2025-26 schedule from today onward." });
  await expect(scheduleDescription).toContainText(
    "2025-26 schedule from today onward. TV lists national broadcasts only. Win % is Baseline's pregame model estimate."
  );
  await expect(page.getByText("LAL")).toBeVisible();
  await expect(page.getByText("@")).toBeVisible();
  await expect(page.getByRole("link", { name: "GSW" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Scheduled" })).toBeVisible();
  await expect(page.getByText("Chase Center")).toBeVisible();
  await expect(page.getByRole("link", { name: "PBP →" })).toHaveCount(0);
  await expectNo2010Range(page);
});

test("schedule shows model win % and consensus odds, linking to the scorecard", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/schedule");
  await expect(page.getByTestId("national-tv")).toHaveText("ESPN");
  await expect(page.getByTestId("win-probability")).toHaveText("38% / 62%");
  await expect(page.getByTestId("moneyline")).toHaveText("+130 / -150");
  await expect(page.getByTestId("spread")).toHaveText("GSW -3.5");
  await page.getByRole("link", { name: "How accurate is the model?" }).click();
  await expect(page).toHaveURL(/\/predictions$/);
  await expect(page.getByRole("heading", { name: "Model scorecard" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Sportsbook market/ })).toBeVisible();
});

test("model scorecard empty warehouse", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/predictions");
  await expect(page.getByText("No graded predictions yet")).toBeVisible();
});

test("schedule empty warehouse", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/schedule");
  await expect(page.getByText("No upcoming games")).toBeVisible();
  await expect(page.getByText(/No scheduled games for .* yet/)).toBeVisible();
  await expect(page.getByText(/scrape-games|then dbt/i)).toHaveCount(0);
});

test("schedule names the day on screen and pins both pager buttons on the only day", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/schedule");
  await expect(page.getByText("Thu, Oct 22, 2026 · 1 game")).toBeVisible();
  await expect(page.getByRole("button", { name: "← Prev day" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next day →" })).toBeDisabled();
});

test("schedule shows one game day at a time and pages to the next one", async ({ page }) => {
  await mockApi(page, { scheduleSecondDay: true });
  await page.goto("/schedule");
  await expect(page.getByText("Thu, Oct 22, 2026 · 1 game")).toBeVisible();
  await expect(page.getByText("Chase Center")).toBeVisible();
  // The later day is held back until asked for.
  await expect(page.getByText("Kaseya Center")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "← Prev day" })).toBeDisabled();

  // Oct 23 has no games, so Next lands on Oct 24 and asks the API from there.
  await page.getByRole("button", { name: "Next day →" }).click();
  await expect(page.getByText("Sat, Oct 24, 2026 · 1 game")).toBeVisible();
  await expect(page.getByText("Kaseya Center")).toBeVisible();
  await expect(page.getByText("Chase Center")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next day →" })).toBeDisabled();
  const calls = await page.evaluate(
    () => (window as unknown as { __API_CALLS__: string[] }).__API_CALLS__
  );
  expect(
    calls.some((url) => url.includes("/schedule") && url.includes("from_date=2026-10-24"))
  ).toBe(true);

  await page.getByRole("button", { name: "← Prev day" }).click();
  await expect(page.getByText("Thu, Oct 22, 2026 · 1 game")).toBeVisible();
  await expect(page.getByText("Chase Center")).toBeVisible();
});

test("schedule surfaces the API failure instead of the empty slate copy", async ({ page }) => {
  await mockApi(page, { fail: true });
  await page.goto("/schedule");
  await expect(page.getByText(API_FAILURE_DETAIL)).toBeVisible();
});
