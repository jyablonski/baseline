import { expect, test } from "@playwright/test";

import { expectPrimaryNav, mockApi, primaryNav } from "./helpers";

test("header shows Baseline tabs, watermark, and no sidebar", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page).toHaveTitle("Baseline");
  await expect(page.getByRole("link", { name: "Baseline" })).toBeVisible();
  // On the home page itself, not in the header that every page shares.
  await expect(page.getByRole("main").getByText(/Scraped /)).toBeVisible();
  await expect(page.getByRole("banner").getByText(/Scraped /)).toHaveCount(0);
  await expect(page.getByText("Court Vision")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toHaveCount(0);
  await expectPrimaryNav(page);

  const nav = primaryNav(page);
  await nav.getByRole("link", { name: "Games" }).click();
  await expect(page).toHaveURL(/\/games$/);
  await expect(page).toHaveTitle("Games — Baseline");
  await expect(page.getByRole("heading", { name: "Games", level: 1 })).toBeVisible();

  await nav.getByRole("link", { name: "Ask" }).click();
  await expect(page).toHaveURL(/\/ask/);
  await expect(page.getByRole("heading", { name: "Ask" })).toBeVisible();

  await expect(nav.getByRole("link", { name: "About" })).toHaveCount(0);
  await page.getByRole("contentinfo").getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about/);
  await expect(page).toHaveTitle("About — Baseline");
  await expect(page.getByRole("heading", { name: "About", exact: true })).toBeVisible();

  await nav.getByRole("link", { name: "Social" }).click();
  await expect(page).toHaveURL(/\/social/);
  await expect(page).toHaveTitle("Social — Baseline");
});
