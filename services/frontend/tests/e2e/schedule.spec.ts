import { expect, test } from "@playwright/test";

import { API_FAILURE_DETAIL, expectNo2010Range, mockApi } from "./helpers";

// The Games page's Schedule & results view. Rows go live and lock by the
// clock, and the page opens on today's Eastern date, so the clock is pinned
// two days before the fixtures' Oct 22 slate and specs open that day by URL.
const SLATE = "/games?date=2026-10-22";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-20T16:00:00Z"));
});

test("an upcoming day lists the slate without scores or 2010-11 copy", async ({ page }) => {
  await mockApi(page);
  await page.goto(SLATE);
  await expect(page.getByRole("heading", { name: "Games", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Thursday, October 22" })).toBeVisible();
  await page.getByRole("button", { name: "TV" }).click();
  await expect(page.getByRole("dialog", { name: "TV" })).toContainText(
    "National TV and streaming broadcasts only."
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "LAL", exact: true })).toBeVisible();
  await expect(page.getByText("@")).toBeVisible();
  await expect(page.getByRole("link", { name: "GSW", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Injuries" }).click();
  await expect(page.getByRole("dialog", { name: "Injuries" })).toContainText(
    "Red: one of them is out."
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "PBP →" })).toHaveCount(0);
  await expect(page.getByText("Picks lock at tip-off.", { exact: false })).toHaveCount(0);
  await expect(
    page.getByText("Win % from Baseline's model; injuries in red include a key player.")
  ).toBeVisible();
  await expectNo2010Range(page);
});

test("an upcoming day shows model win % and consensus odds, linking to the scorecard", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto(SLATE);
  await expect(page.getByTestId("national-tv")).toHaveText("ESPN");
  await expect(page.getByTestId("win-probability")).toHaveText("38% / 62%");
  await expect(page.getByTestId("moneyline")).toHaveText("+130 / -150");
  await expect(page.getByTestId("spread")).toHaveText("GSW -3.5");
  await expect(page.getByRole("button", { name: "Odds" })).toBeVisible();
  await page.getByRole("button", { name: "Win %" }).click();
  await page
    .getByRole("dialog", { name: "Win %" })
    .getByRole("link", { name: "How accurate is the model? →" })
    .click();
  await expect(page).toHaveURL(/\/predictions$/);
  await expect(page.getByRole("heading", { name: "How accurate is the model?" })).toBeVisible();
  await expect(page.getByText("Elo v0 sets the win %")).toBeVisible();
  await expect(page.getByText("Home 60–70%")).toBeVisible();
  await expect(page.getByRole("link", { name: "GSW 62% vs LAL" })).toBeVisible();
  await expect(page.getByTestId("model-weights")).toContainText("Worth 4.5 points");
  await page.getByText("Accuracy Details").click();
  await expect(page.getByRole("row", { name: /Sportsbook market/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Biggest upsets" })).toHaveCount(0);
});

test("model scorecard empty warehouse", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/predictions");
  await expect(page.getByText("No graded predictions yet")).toBeVisible();
});

test("an empty warehouse says there are no games, without operator copy", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/games");
  await expect(page.getByRole("heading", { name: "Today · Tuesday, October 20" })).toBeVisible();
  await expect(page.getByText("No games on this date.")).toBeVisible();
  await expect(page.getByText(/scrape-games|then dbt/i)).toHaveCount(0);
});

test("the week strip counts each day and steps through days and weeks", async ({ page }) => {
  await mockApi(page, { scheduleSecondDay: true });
  await page.goto("/games");
  const strip = page.getByRole("group", { name: "Game days" });
  await expect(page.getByRole("heading", { name: "Today · Tuesday, October 20" })).toBeVisible();
  await expect(strip.getByTestId("week-day")).toHaveText([
    "Sat 17No games",
    "Sun 18No games",
    "Mon 19No games",
    "Tue 20Today",
    "Wed 21No games",
    "Thu 221 game",
    "Fri 23No games",
  ]);
  // Today holds no games, so the empty line points at the next day that does.
  await page.getByRole("link", { name: "Next games: Thu, Oct 22 →" }).click();
  await expect(page).toHaveURL(/\/games\?date=2026-10-22$/);
  await expect(page.getByRole("link", { name: "GSW", exact: true })).toBeVisible();

  await strip.getByRole("button", { name: "Next week" }).click();
  await expect(page).toHaveURL(/\/games\?date=2026-10-29$/);
  await expect(strip.getByTestId("week-day").first()).toHaveText(/^Sat 24/);
  await expect(strip.getByRole("button", { name: /Sat 24/ })).toContainText("1 game");

  // The calendar marks only game days and jumps back to today.
  await strip.getByRole("button", { name: /Pick a game day/ }).click();
  const calendar = page.getByRole("dialog", { name: "October 2026" });
  await expect(calendar.getByRole("button", { name: "Fri, Oct 23, no games" })).toBeDisabled();
  await calendar.getByRole("button", { name: "Today" }).click();
  await expect(page).toHaveURL(/\/games$/);
});

test("back and forward step through days and views", async ({ page }) => {
  await mockApi(page, { scheduleSecondDay: true });
  await page.goto("/games");
  await page.getByRole("button", { name: /Thu 22/ }).click();
  await expect(page).toHaveURL(/date=2026-10-22$/);
  await page
    .getByRole("navigation", { name: "Games views" })
    .getByRole("link", {
      name: "Season notables",
    })
    .click();
  await expect(page).toHaveURL(/\/games\?view=notables$/);
  await expect(page.getByTestId("notables-table")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/date=2026-10-22$/);
  await expect(page.getByRole("heading", { name: "Thursday, October 22" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/games$/);
  await expect(page.getByRole("heading", { name: "Today · Tuesday, October 20" })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/date=2026-10-22$/);
});

test("the old Schedule and Past Games addresses redirect, keeping their params", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/schedule?date=2026-10-22&mine=1");
  await expect(page).toHaveURL(/\/games\?date=2026-10-22&mine=1$/);
  await expect(page.getByRole("heading", { name: "Thursday, October 22" })).toBeVisible();

  // Past Games opens on the latest day with finals.
  await page.goto("/past-games?tab=upsets");
  await expect(page).toHaveURL(/\/games\?tab=upsets&date=2024-10-22$/);
  await expect(page.getByTestId("result-row")).toContainText("Stephen Curry 38, LeBron James 35");
});

for (const width of [900, 1280]) {
  test(`an upcoming day fits ${width}px without sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page);
    await page.goto(SLATE);
    await expect(page.getByTestId("schedule-table")).toBeVisible();
    const overflow = await page.evaluate(() => {
      const table = document.querySelector<HTMLElement>('[data-testid="schedule-table"]')!;
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        table: table.scrollWidth - table.clientWidth,
      };
    });
    expect(overflow).toEqual({ page: 0, table: 0 });
  });
}

test("on a phone the strip scrolls to the day on screen and games stack as cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await mockApi(page);
  await page.goto("/games?date=2026-10-25");
  const selected = page.getByRole("button", { name: /Sun 25/ });
  await expect(selected).toHaveAttribute("aria-current", "date");
  await expect(selected).toBeInViewport();
  await page.goto(SLATE);
  // The column heads are hidden; each value carries its own label instead.
  await expect(page.getByRole("columnheader", { name: "Odds" })).toBeHidden();
  const odds = page.getByTestId("moneyline").locator("..");
  expect(await odds.evaluate((cell) => getComputedStyle(cell, "::before").content)).toBe('"Odds"');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("an upcoming day surfaces the API failure instead of the empty copy", async ({ page }) => {
  await mockApi(page, { fail: true });
  await page.goto(SLATE);
  await expect(page.getByText(API_FAILURE_DETAIL)).toBeVisible();
});

test("a B2B badge opens last night's result without leaving the page", async ({ page }) => {
  await mockApi(page);
  await page.goto(SLATE);
  await expect(page.getByText("Played last night")).toBeVisible();
  await page.getByRole("button", { name: "LAL played last night: L 108–115 @ SAC" }).click();
  const popover = page.getByRole("dialog", { name: "LAL played last night" });
  await expect(popover).toContainText("L 108–115 @ SAC · second night of a back-to-back");
  // A sibling of the team link, so the tap opens the detail instead of navigating.
  await expect(page).toHaveURL(/\/games\?date=2026-10-22$/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
