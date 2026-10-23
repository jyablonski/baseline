import { expect, test } from "@playwright/test";

import { API_FAILURE_DETAIL, expectNo2010Range, mockApi } from "./helpers";

// Rows go live and lock by the clock, and the first day asked for is today's
// Eastern date, so the clock is pinned before the fixtures' Oct 22 slate.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-20T16:00:00Z"));
});

test("schedule lists the upcoming slate without scores or 2010-11 copy", async ({ page }) => {
  await mockApi(page);
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  const scheduleDescription = page
    .locator("p")
    .filter({ hasText: "2025-26 schedule from today onward." });
  await expect(scheduleDescription).toHaveText(
    "2025-26 schedule from today onward. Finished games are under Games."
  );
  await page.getByRole("button", { name: "TV" }).click();
  await expect(page.getByRole("dialog", { name: "TV" })).toContainText(
    "National TV and streaming broadcasts only."
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("LAL")).toBeVisible();
  await expect(page.getByText("@")).toBeVisible();
  await expect(page.getByRole("link", { name: "GSW" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Scheduled" })).toBeVisible();
  await expect(page.getByText("Chase Center")).toBeVisible();
  await expect(page.getByRole("link", { name: "PBP →" })).toHaveCount(0);
  await expectNo2010Range(page);
});

test("schedule shows model win % and consensus odds, linking to the scorecard", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/schedule");
  await expect(page.getByTestId("national-tv")).toHaveText("ESPN");
  await expect(page.getByTestId("win-probability")).toHaveText("38% / 62%");
  await expect(page.getByTestId("moneyline")).toHaveText("+130 / -150");
  await expect(page.getByTestId("spread")).toHaveText("GSW -3.5");
  await expect(page.getByRole("button", { name: "Odds" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Moneyline" })).toHaveCount(0);
  await page.getByRole("button", { name: "Win %" }).click();
  await page
    .getByRole("dialog", { name: "Win %" })
    .getByRole("link", { name: "How accurate is the model? →" })
    .click();
  await expect(page).toHaveURL(/\/predictions$/);
  await expect(page.getByRole("heading", { name: "Model Scorecard" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Sportsbook market/ })).toBeVisible();
  // Upsets moved to the Games page.
  await expect(page.getByRole("heading", { name: "Biggest upsets" })).toHaveCount(0);
});

test("model scorecard empty warehouse", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/predictions");
  await expect(page.getByText("No graded predictions yet")).toBeVisible();
});

test("schedule empty warehouse", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/schedule");
  await expect(page.getByText("No upcoming games")).toBeVisible();
  await expect(page.getByText(/No scheduled games for .* yet/)).toBeVisible();
  await expect(page.getByText(/scrape-games|then dbt/i)).toHaveCount(0);
});

test("schedule names the day on screen and pins both arrows on the only day", async ({ page }) => {
  await mockApi(page);
  await page.goto("/schedule");
  // The clock is pinned to Oct 20, so the soonest game day is "Next up", not today.
  await expect(page.getByRole("heading", { name: "Next up · Thursday, October 22" })).toBeVisible();
  await expect(page.getByText("1 game", { exact: true })).toBeVisible();
  const picker = page.getByRole("group", { name: "Game day" });
  await expect(picker.getByRole("button", { name: "Earlier game day" })).toBeDisabled();
  await expect(picker.getByRole("button", { name: "Later game day" })).toBeDisabled();
  // The old bottom pager is gone.
  await expect(page.getByRole("button", { name: "Next day →" })).toHaveCount(0);
});

test("schedule uses the same day picker as games: arrows, calendar, and the URL", async ({
  page,
}) => {
  await mockApi(page, { scheduleSecondDay: true });
  await page.goto("/schedule");
  await expect(page.getByText("Chase Center")).toBeVisible();
  // The later day is held back until asked for.
  await expect(page.getByText("Kaseya Center")).toHaveCount(0);
  const picker = page.getByRole("group", { name: "Game day" });
  await expect(picker.getByRole("button", { name: "Earlier game day" })).toBeDisabled();

  // Oct 23 has no games, so the arrow lands on Oct 24 and asks the API from there.
  await picker.getByRole("button", { name: "Later game day" }).click();
  await expect(page).toHaveURL(/\/schedule\?date=2026-10-24$/);
  await expect(page.getByRole("heading", { name: "Saturday, October 24" })).toBeVisible();
  await expect(page.getByText("Kaseya Center")).toBeVisible();
  await expect(page.getByText("Chase Center")).toHaveCount(0);
  await expect(picker.getByRole("button", { name: "Later game day" })).toBeDisabled();
  const calls = await page.evaluate(
    () => (window as unknown as { __API_CALLS__: string[] }).__API_CALLS__
  );
  expect(
    calls.some((url) => url.includes("/schedule/dates") && url.includes("from_date=2026-10-20"))
  ).toBe(true);
  expect(
    calls.some(
      (url) =>
        url.includes("/schedule?") &&
        !url.includes("/dates") &&
        url.includes("from_date=2026-10-24")
    )
  ).toBe(true);

  // The calendar marks only game days and jumps back to the soonest.
  await picker.getByRole("button", { name: /Pick a game day/ }).click();
  const calendar = page.getByRole("dialog", { name: "October 2026" });
  await expect(calendar.getByRole("button", { name: "Thu, Oct 22" })).toBeEnabled();
  await expect(calendar.getByRole("button", { name: "Fri, Oct 23, no games" })).toBeDisabled();
  await expect(calendar.getByRole("button", { name: "Sat, Oct 24" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await calendar.getByRole("button", { name: "Next up" }).click();
  await expect(page).toHaveURL(/\/schedule$/);
  await expect(page.getByRole("heading", { name: "Next up · Thursday, October 22" })).toBeVisible();
  await expect(page.getByText("Chase Center")).toBeVisible();

  // A shared link opens on its day.
  await page.goto("/schedule?date=2026-10-24");
  await expect(page.getByText("Kaseya Center")).toBeVisible();
  // A date with no games says so, and the arrows still step to the days around it.
  await page.goto("/schedule?date=2026-10-23");
  await expect(page.getByText("No games are scheduled for this date.")).toBeVisible();
  await expect(picker.getByRole("button", { name: "Earlier game day" })).toBeEnabled();
  await expect(picker.getByRole("button", { name: "Later game day" })).toBeEnabled();
});

for (const width of [1400, 390]) {
  test(`games and schedule put the day header and picker in the same place at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, { scheduleSecondDay: true });
    const boxes: Record<string, { title: number[]; picker: number[] }> = {};
    for (const path of ["/games", "/schedule"]) {
      await page.goto(path);
      const picker = page.getByRole("group", { name: "Game day" });
      await expect(picker).toBeVisible();
      const round = (box: { x: number; y: number; width: number; height: number } | null) =>
        box ? [box.x, box.y, box.width, box.height].map(Math.round) : [];
      boxes[path] = {
        title: round(await page.locator("h2").first().boundingBox()),
        picker: round(await picker.boundingBox()),
      };
    }
    // Same top and left for the title; the same box for the picker, whatever the date.
    expect(boxes["/schedule"].title.slice(0, 2)).toEqual(boxes["/games"].title.slice(0, 2));
    expect(boxes["/schedule"].picker).toEqual(boxes["/games"].picker);
  });
}

test("schedule surfaces the API failure instead of the empty slate copy", async ({ page }) => {
  await mockApi(page, { fail: true });
  await page.goto("/schedule");
  await expect(page.getByText(API_FAILURE_DETAIL)).toBeVisible();
});
