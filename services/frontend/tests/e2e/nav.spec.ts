import { expect, test } from "@playwright/test";

import { expectPrimaryNav, mockApi, primaryNav } from "./helpers";

test("header shows Baseline tabs, watermark, and no sidebar", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page).toHaveTitle("Baseline");
  await expect(page.getByRole("link", { name: "Baseline" })).toBeVisible();
  await expect(page.getByText(/Scraped /).first()).toBeVisible();
  await expect(page.getByText("Court Vision")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toHaveCount(0);
  await expectPrimaryNav(page);

  const nav = primaryNav(page);
  await page.goto("/games");
  await expect(page).toHaveURL(/\/games/);
  await expect(page).toHaveTitle("Games — Baseline");
  await expect(page.getByRole("heading", { name: "Game flow" })).toBeVisible();

  await nav.getByRole("link", { name: "Ask" }).click();
  await expect(page).toHaveURL(/\/ask/);
  await expect(page.getByRole("heading", { name: "Ask" })).toBeVisible();

  await nav.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about/);
  await expect(page).toHaveTitle("About — Baseline");
  await expect(page.getByRole("heading", { name: "About", exact: true })).toBeVisible();

  await nav.getByRole("link", { name: "Social" }).click();
  await expect(page).toHaveURL(/\/social/);
  await expect(page).toHaveTitle("Social — Baseline");
});
