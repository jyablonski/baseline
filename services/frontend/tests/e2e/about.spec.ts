import { expect, test } from "@playwright/test";

import { expectNo2010Range, mockApi } from "./helpers";

test("About lists ingest sources without salary jargon or 2010-11 copy", async ({ page }) => {
  await mockApi(page);
  await page.goto("/about");
  const about = page.getByRole("article");
  await expect(page.getByRole("heading", { name: "About", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Baseline" })).toHaveCount(0);
  await expect(page.getByText("Working title, not final")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await expect(about.getByText("Basketball-Reference")).toBeVisible();
  await expect(about.getByText("The Odds API")).toBeVisible();
  await expect(about.getByText(/r\/nba posts/)).toBeVisible();
  await expect(about.getByText(/transformed and enriched/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "How the data gets here" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();
  await expect(page.getByText(/Coverage defaults to the latest season/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "About the salary figures" })).toHaveCount(0);
  await expect(about.getByText(/Postgres/i)).toHaveCount(0);
  await expect(about.getByText(/dbt/i)).toHaveCount(0);
  await expect(about.getByText(/FastAPI/i)).toHaveCount(0);
  await expectNo2010Range(page);
  await expect(about).not.toContainText("—");
});

test("About no longer carries the scraped watermark", async ({ page }) => {
  await mockApi(page);
  await page.goto("/about");
  await expect(page.getByRole("heading", { name: "Last scraped" })).toHaveCount(0);
  await expect(page.getByRole("article").getByText(/Scraped /)).toHaveCount(0);
});

test("About credits the developer and names the running build", async ({ page }) => {
  await mockApi(page);
  await page.goto("/about");
  const about = page.getByRole("article");
  await expect(about.getByText("Jacob Yablonski")).toBeVisible();
  await expect(about.getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/jyablonski"
  );
  await expect(about.getByRole("link", { name: "LinkedIn" })).toHaveAttribute(
    "href",
    "https://www.linkedin.com/in/jacobyablonski/"
  );
  await expect(page.getByRole("heading", { name: "Version" })).toBeVisible();
  // Version carries the sha (or "dev") and nothing else.
  const version = page.locator("section", { has: page.getByRole("heading", { name: "Version" }) });
  await expect(version.locator("div")).toHaveText(/^[0-9a-f]{7}$|^dev$/);
});

test("About version reports the build and nothing else", async ({ page }) => {
  await mockApi(page);
  await page.goto("/about");

  const version = page.locator("section", { has: page.getByRole("heading", { name: "Version" }) });
  // Unbaked dev builds report "dev"; a real image reports a short sha.
  await expect(version.locator("div")).toHaveText(/^[0-9a-f]{7}$|^dev$/);
  await expect(page.getByRole("heading", { name: "Developer" })).toBeVisible();
});
