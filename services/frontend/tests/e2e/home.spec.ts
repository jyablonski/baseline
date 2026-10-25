import { expect, test } from "@playwright/test";

import { API_FAILURE_DETAIL, expectNo2010Range, mockApi } from "./helpers";

test("home desk shows the latest slate, next games, standings, and r/nba", async ({ page }) => {
  // "Next up" turns into "Games today" on the fixtures' Oct 22 slate date, so
  // the clock is pinned before it.
  await page.clock.setFixedTime(new Date("2026-10-20T16:00:00Z"));
  await mockApi(page);
  await page.goto("/");
  // The fixture slate is long past, so it is the latest one, not last night's.
  await expect(page.getByRole("heading", { name: "Latest results" })).toBeVisible();
  await expect(page.getByText("Tuesday, October 22 · 1 game")).toBeVisible();
  await expect(page.getByRole("link", { name: "LAL 110, GSW 120: game flow" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What stood out" })).toHaveCount(0);
  await expect(page.getByText("Stephen Curry 38, LeBron James 35")).toBeVisible();
  await expect(page.getByTitle("National TV: ESPN")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next up" })).toBeVisible();
  await expect(page.getByText("Thu 22 Oct · 1 game · ET")).toBeVisible();
  await expect(page.getByText("GSW has won 5 straight")).toBeVisible();
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
  await expectNo2010Range(page);
});

test("home modules link out to their full views", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  // Every module heads with a link named like the nav, so exact: the nav has "Games" too.
  await expect(page.getByRole("link", { name: "Games →", exact: true })).toHaveAttribute(
    "href",
    "/games"
  );
  await expect(page.getByRole("link", { name: "Schedule →", exact: true })).toHaveAttribute(
    "href",
    /^\/schedule/
  );
  await expect(page.getByRole("link", { name: "Social →", exact: true })).toHaveAttribute(
    "href",
    "/social"
  );
  await page.getByRole("link", { name: "Teams →", exact: true }).click();
  await expect(page).toHaveURL(/\/teams/);
  await expect(page.getByRole("heading", { name: "Teams", level: 1 })).toBeVisible();
  await expect(page.getByText("Eastern Conference")).toBeVisible();
  await expect(page.getByText("Western Conference")).toBeVisible();
});

test("home standings cover both conferences with form columns", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");

  const standings = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Standings" }) })
    .first();
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
