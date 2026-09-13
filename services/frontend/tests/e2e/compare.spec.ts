import { expect, test } from "@playwright/test";

import { expectNo2010Range, mockApi } from "./helpers";

test("compare empty state asks for two players", async ({ page }) => {
  await mockApi(page);
  await page.goto("/players/compare");
  await expect(page).toHaveTitle("Compare — Baseline");
  await expect(page.getByRole("heading", { name: "Compare players" })).toBeVisible();
  await expect(page.getByText("Select two players from the directory.")).toBeVisible();
  await expectNo2010Range(page);
});

test("compare two-player table captions available seasons, not 2010-11", async ({ page }) => {
  await mockApi(page);
  await page.goto(
    "/players/compare?ids=00000000-0000-4000-8000-000000202695,00000000-0000-4000-8000-000000201939"
  );
  await expect(page.getByRole("link", { name: "Kawhi Leonard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Stephen Curry" })).toBeVisible();
  await expect(page.getByText(/career/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Season" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Head-to-head" })).toBeVisible();
  await expectNo2010Range(page);

  await page.getByRole("button", { name: "Head-to-head" }).click();
  await expect(
    page.getByText("No head-to-head games to show. Teammate games are not counted.")
  ).toBeVisible();
  await expectNo2010Range(page);
});
