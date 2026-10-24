import { expect, test } from "@playwright/test";

import { mockApi, primaryNav } from "./helpers";

// TODO: cleanup once the /data page has a proper nav entry
test("About the data renders by URL without a nav entry", async ({ page }) => {
  await mockApi(page);
  await page.goto("/data");
  await expect(page.getByRole("heading", { level: 1, name: "About the data" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Win prediction models" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Sportsbook market/ })).toBeVisible();
  await expect(primaryNav(page).getByRole("link", { name: /data/i })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
