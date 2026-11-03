import { expect, test } from "@playwright/test";

import { API_FAILURE_DETAIL, expectNo2010Range, mockApi } from "./helpers";

test("teams directory to profile walks the team tabs", async ({ page }) => {
  await mockApi(page);
  await page.goto("/teams");
  await expect(page).toHaveTitle("Teams — Baseline");
  await expect(page.getByRole("heading", { name: "Teams" })).toBeVisible();
  await expect(page.getByText(/Records shown for/)).toHaveCount(0);
  await expect(page.getByText(/30 clubs/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "GSW" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Offense vs defense" })).toBeVisible();
  await expectNo2010Range(page);

  await page.getByRole("link", { name: "GSW" }).click();
  await expect(page.getByRole("heading", { name: "Golden State Warriors" })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Team sections" });
  await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(tabs.getByLabel("1 out")).toBeVisible();
  await expect(page.getByTestId("team-ratings")).toContainText("Net rating");
  await expect(page.getByTestId("team-ratings")).toContainText("+9.8");
  await expect(page.getByTestId("injury-row")).toContainText("Out · Ankle");

  await tabs.getByRole("link", { name: "Stats" }).click();
  await expect(page).toHaveURL(/tab=stats/);
  await expect(page.getByRole("row", { name: /Offensive rebound %/ })).toContainText("34.8%");
  await page.getByRole("button", { name: "Last 10" }).click();
  await expect(page.getByText(/· 10 games/)).toBeVisible();

  await tabs.getByRole("link", { name: /Roster/ }).click();
  const curry = page.getByTestId("roster-row");
  await expect(curry).toContainText("Stephen Curry");
  await expect(curry).toContainText("62.0%");
  await expect(curry).toContainText("Out · Ankle");

  await tabs.getByRole("link", { name: "Cap" }).click();
  await expect(page.getByText("Cap position").first()).toBeVisible();

  await tabs.getByRole("link", { name: "Moves" }).click();
  const moves = page.getByRole("region", { name: "Recent moves" });
  await expect(moves.getByText("Signed", { exact: true })).toBeVisible();
  await expect(moves.getByRole("link", { name: "Stephen Curry" })).toHaveAttribute(
    "href",
    "/players/stephen-curry"
  );
});

test("standings carry net rating", async ({ page }) => {
  await mockApi(page);
  await page.goto("/teams");
  const west = page.getByRole("region", { name: "Western Conference" });
  await expect(west.getByRole("columnheader", { name: "Net" })).toBeVisible();
  const gsw = west.getByRole("row", { name: /GSW/ });
  await expect(gsw.getByRole("cell", { name: "+9.8", exact: true })).toBeVisible();
});

test("teams page ranks both conferences without a 2010-11 range", async ({ page }) => {
  await mockApi(page);
  await page.goto("/teams");
  await expect(page.getByRole("heading", { name: "Teams", level: 1 })).toBeVisible();
  await expect(page.getByText("Eastern Conference")).toBeVisible();
  await expect(page.getByText("Western Conference")).toBeVisible();
  await expect(page.getByRole("link", { name: "CHI" })).toBeVisible();
  await expect(page.getByRole("link", { name: "GSW" })).toBeVisible();
  await expectNo2010Range(page);
});

test("teams directory empty warehouse", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/teams");
  await expect(page.getByText("No standings yet")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Offense vs defense" })).toHaveCount(0);
});

test("teams page plots each team as a bare logo marker", async ({ page }) => {
  await mockApi(page);
  await page.goto("/teams");

  const scatter = page.locator("section[aria-labelledby='team-ratings-heading']");
  await expect(scatter).toBeVisible();
  await expect(scatter.getByText("Good on both ends")).toBeVisible();
  await expect(scatter.getByText(/^League avg/)).toHaveCount(2);
  // Markers are the logo image alone until a team is highlighted.
  await expect(scatter.locator("image")).toHaveCount(3);
  await expect(scatter.locator("circle")).toHaveCount(0);
  const picker = scatter.getByRole("combobox", { name: "Highlight" });
  await picker.selectOption({ index: 1 });
  await expect(scatter.locator("circle")).toHaveCount(1);
  await expect(scatter.getByRole("button", { name: "Last 15" })).toHaveCount(0);
});

test("teams directory surfaces the API failure instead of an empty grid", async ({ page }) => {
  await mockApi(page, { fail: true });
  await page.goto("/teams");
  await expect(page.getByText(API_FAILURE_DETAIL).first()).toBeVisible();
});

test("teams page lists streak and last-ten columns for both conferences", async ({ page }) => {
  await mockApi(page);
  await page.goto("/teams");
  await expect(page.getByRole("columnheader", { name: "Strk" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "W5", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "L10" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "8-2", exact: true })).toBeVisible();
  await expectNo2010Range(page);
});

test("team schedule tab is a season calendar whose games link to their pages", async ({ page }) => {
  await mockApi(page);
  await page.goto("/teams/golden-state-warriors?tab=schedule");
  const calendar = page.getByTestId("season-calendar");
  await expect(calendar.getByRole("heading", { name: "April 2026" })).toBeVisible();

  const win = calendar.getByRole("link", { name: /Apr 10, 2026, at CHI, won 112–104/ });
  await expect(win).toBeVisible();
  await expect(calendar.getByRole("link", { name: /Apr 11, 2026, vs LAL/ })).toContainText("B2B");

  await win.click();
  await expect(page).toHaveURL(/\/games\/0022400001/);
});

test("team profile shows the calendar on a phone too", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto("/teams/golden-state-warriors?tab=schedule");
  await expect(page.getByTestId("season-calendar")).toBeVisible();
});
