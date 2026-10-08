import { expect, test } from "@playwright/test";

import { mockApi, primaryNav } from "./helpers";

test("social reaches from the nav and labels its sampling honestly", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await primaryNav(page).getByRole("link", { name: "Social" }).click();

  await expect(page).toHaveURL(/\/social/);
  await expect(page.getByRole("heading", { name: "Social", level: 1 })).toBeVisible();

  // The gap between captured and posted comments has to stay on screen.
  await expect(page.getByText("2% of 18,204 posted")).toBeVisible();
  // Comments stay collapsed until asked for.
  await expect(page.getByRole("button", { name: "Hide comments" })).toHaveCount(0);
  await page.getByRole("button", { name: "Top comments (1)" }).click();
  await expect(page.getByRole("button", { name: "Hide comments" })).toBeVisible();

  // Feed cards carry score and comments only; the per-post ratio strip is gone.
  await expect(page.getByText("132.00")).toHaveCount(0);
  await expect(page.getByText(/What r\/nba is talking about\./)).toBeVisible();

  await expect(page.getByRole("heading", { name: "Player mentions" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Team mentions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fanbase comments" })).toBeVisible();
  // Team mentions read "Clippers", like the fanbase board, not "LA Clippers LAC".
  const teams = page.locator("section").filter({ hasText: "Team mentions" });
  await expect(teams.getByText("Clippers", { exact: true })).toBeVisible();
  await expect(teams.getByText("LAC", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/what this page cannot tell you/i)).toHaveCount(0);
});

test("social filters write to the URL", async ({ page }) => {
  await mockApi(page);
  await page.goto("/social");
  await page.getByRole("button", { name: /highlight 12/i }).click();
  await expect(page).toHaveURL(/type=highlight/);
  await page.getByRole("button", { name: "24h", exact: true }).click();
  await expect(page).toHaveURL(/range=24h/);
});

test("social explains a quiet range instead of rendering an empty shell", async ({ page }) => {
  await mockApi(page, { empty: true });
  await page.goto("/social");
  await expect(page.getByText(/nothing collected in this range/i)).toBeVisible();
  await expect(page.getByText(/nothing has been collected for these days yet/i)).toBeVisible();
});

test("the active filter chip is legible, not paper-on-paper", async ({ page }) => {
  await mockApi(page);
  await page.goto("/social");

  // A typo'd design token (bg-ink, which this theme does not define) leaves the
  // chip background transparent while the label keeps its paper colour, so the
  // active chip renders blank. Type checking and unit tests cannot see that.
  for (const chip of [
    page.getByRole("button", { name: "7d" }),
    page.getByRole("button", { name: /^All/ }),
  ]) {
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    const style = await chip.evaluate((node) => {
      const computed = getComputedStyle(node);
      return { color: computed.color, background: computed.backgroundColor };
    });
    expect(style.color).not.toBe(style.background);
    expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
  }

  await expect(page.getByRole("button", { name: "7d" })).toContainText("7d");
  await expect(page.getByRole("button", { name: /^All/ })).toContainText("All");
});

test("social summary cards carry the capture meter and the contested thread link", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/social");
  await expect(page.getByText("from 33 distinct posters")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  await expect(page.getByText("9 posts · 63 captured comments")).toBeVisible();
  await expect(page.getByText("132 comments on a score of 0")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open ↗" })).toHaveAttribute(
    "href",
    "https://www.reddit.com/r/nba/comments/zero1/"
  );
});

test("social feed rows link mentions and the thread, and expand comments inline", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/social");
  const row = page.getByRole("article");
  await expect(row.getByRole("link", { name: "Jaylen Brown" })).toHaveAttribute(
    "href",
    "/players/jaylen-brown"
  );
  await expect(row.getByRole("link", { name: "Boston Celtics" })).toHaveAttribute(
    "href",
    "/teams/boston-celtics"
  );
  await expect(row.getByRole("link", { name: "Thread ↗" })).toHaveAttribute(
    "href",
    "https://www.reddit.com/r/nba/comments/zero1/"
  );
  await row.getByRole("button", { name: "Top comments (1)" }).click();
  await expect(row.getByText(/single conference finals run/)).toBeVisible();
  await expect(row.getByText("u/DeadEyeDuncan21")).toBeVisible();
  await row.getByRole("button", { name: "Hide comments" }).click();
  await expect(row.getByText(/single conference finals run/)).toHaveCount(0);
});

test("social columns line up: figures under their labels, sort flush with the rail", async ({
  page,
}) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/social");
  const right = async (locator: ReturnType<typeof page.locator>) => {
    const box = await locator.boundingBox();
    return Math.round((box?.x ?? 0) + (box?.width ?? 0));
  };
  const rail = page.locator("section").filter({ hasText: "Team mentions" }).last();
  await expect(rail).toBeVisible();
  expect(await right(page.locator("select"))).toBe(await right(rail));

  const row = page.getByRole("article");
  await expect(row).toBeVisible();
  expect(await right(page.locator("span", { hasText: /^Comments$/ }))).toBe(
    await right(row.getByText("132", { exact: true }))
  );
});
