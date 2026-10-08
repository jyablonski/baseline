import { expect, test } from "@playwright/test";

import { API_FAILURE_DETAIL, expectNo2010Range, mockApi } from "./helpers";

test("home desk shows the latest slate, next games, standings, and r/nba", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  // The fixture slate is long past, so it is the latest one, not last night's.
  await expect(page.getByRole("heading", { name: "Latest results" })).toBeVisible();
  await expect(page.getByText("Tue 22 Oct · 1 game")).toBeVisible();
  await expect(page.getByRole("link", { name: "LAL 110, GSW 120: game flow" })).toBeVisible();
  // The featured card and the line under the score are the same highlight.
  await expect(page.getByRole("heading", { name: "What stood out" })).toBeVisible();
  await expect(page.getByText("Scoring duel")).toBeVisible();
  await expect(page.getByText("Stephen Curry 38, LeBron James 35")).toHaveCount(2);
  await expect(page.getByTitle("National TV: ESPN")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next up" })).toBeVisible();
  await expect(page.getByText("Thu 22 Oct · ET")).toBeVisible();
  await expect(page.getByText("GSW W5")).toBeVisible();
  await expect(page.getByRole("heading", { name: "On r/nba" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Most overrated players?" })).toBeVisible();
  await expect(page.getByText("Season leaders")).toHaveCount(0);
  await expectNo2010Range(page);
});

test("home empty warehouse shows empty copy for every module", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/");
  await expect(page.getByText("No games yet for this season.")).toBeVisible();
  await expect(page.getByText("No upcoming games on the schedule.")).toBeVisible();
  await expect(page.getByText("No standings yet")).toBeVisible();
  await expect(page.getByText("No posts have been collected yet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What stood out" })).toHaveCount(0);
  await expectNo2010Range(page);
});

test("home modules link out to their full views", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "All results →" })).toHaveAttribute("href", "/games");
  await expect(page.getByRole("link", { name: "Full schedule →" })).toHaveAttribute(
    "href",
    /^\/schedule/
  );
  await expect(page.getByRole("link", { name: "Social →" })).toHaveAttribute("href", "/social");
  await page.getByRole("link", { name: "Full standings →" }).click();
  await expect(page).toHaveURL(/\/standings/);
  await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
  await expect(page.getByText("Eastern Conference")).toBeVisible();
  await expect(page.getByText("Western Conference")).toBeVisible();
});

test("home standings cover both conferences with form columns", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");

  const standings = page.locator("section").filter({ hasText: "Full standings" }).first();
  await expect(standings.getByText("East", { exact: true })).toBeVisible();
  await expect(standings.getByText("West", { exact: true })).toBeVisible();
  for (const name of ["W–L", "GB", "L10", "Strk"]) {
    await expect(standings.getByRole("columnheader", { name, exact: true })).toHaveCount(2);
  }
  await expect(standings.getByText("50–32")).toBeVisible();
  await expect(standings.getByText("8-2")).toBeVisible();
  await expect(standings.getByText("W5")).toBeVisible();
});

test("home surfaces the API failure instead of the empty-warehouse copy", async ({ page }) => {
  await mockApi(page, { fail: true });
  await page.goto("/");
  await expect(page.getByText(API_FAILURE_DETAIL).first()).toBeVisible();
});
