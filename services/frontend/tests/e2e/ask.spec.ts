import { expect, test } from "@playwright/test";

import { expectNo2010Range, mockApi } from "./helpers";

test("Ask stays empty until a Try chip, and chips do not say since 2010-11", async ({ page }) => {
  await mockApi(page);
  await page.goto("/ask");
  await expect(page.getByRole("heading", { name: "Ask" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Try" })).toBeVisible();
  await expect(page.getByText("Nothing asked yet")).toBeVisible();
  await expect(page.getByRole("button", { name: /back-to-backs has Kawhi/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Who leads the West/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /since 2010-11/i })).toHaveCount(0);
  await expectNo2010Range(page);
});

test("Ask suggestion returns a 200 answer without SQL", async ({ page }) => {
  await mockApi(page);
  await page.goto("/ask");
  await page.getByRole("button", { name: /back-to-backs has Kawhi/i }).click();
  await expect(page.getByText("Kawhi Leonard has 12 back-to-back sets")).toBeVisible();
  await expect(page.getByText("Reading this as")).toBeVisible();
  await expect(page.getByRole("link", { name: "Kawhi Leonard page →" })).toHaveAttribute(
    "href",
    "/players/kawhi-leonard"
  );
  await expect(
    page
      .getByRole("region", { name: "Ask next" })
      .getByRole("button", { name: "Kawhi Leonard salary" })
  ).toBeVisible();
  await expect(page.getByText("Show SQL")).toHaveCount(0);
  await expect(page.getByText("Hide SQL")).toHaveCount(0);
});
