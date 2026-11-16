import { expect, test } from "@playwright/test";

import { mockApi } from "./helpers";

test("About links to About the data, which search engines may index", async ({ page }) => {
  await mockApi(page);
  await page.goto("/about");
  await page.getByRole("link", { name: "About the data" }).click();
  await expect(page).toHaveURL(/\/data$/);
  await expect(page.getByRole("heading", { level: 1, name: "About the data" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Win prediction models" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Sportsbook market/ })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});
