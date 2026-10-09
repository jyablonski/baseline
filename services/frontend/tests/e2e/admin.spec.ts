import { expect, test } from "@playwright/test";

import { primaryNav } from "./helpers";

/**
 * The /admin gate, end to end.
 *
 * These run against the real middleware and the real NextAuth config as an
 * anonymous visitor. Unlike the other specs there is no API mocking, because
 * the redirect happens in middleware before any data fetch — and the admin
 * page is a server component, so mocking window.fetch could not reach it
 * anyway. Signed-in visitors, owner and otherwise, are in accounts.spec.ts.
 */

test("unauthenticated /admin redirects to the sign-in page", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/signin/);
  await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
  // The operational data must never render for an anonymous visitor.
  await expect(page.getByRole("heading", { name: "System status" })).toHaveCount(0);
  await expect(page.getByText("Ingestion gate")).toHaveCount(0);
});

test("the sign-in page itself is reachable without a session", async ({ page }) => {
  // If this were gated too, every visitor would hit a redirect loop.
  await page.goto("/admin/signin");
  await expect(page).toHaveURL(/\/admin\/signin/);
  await expect(page.getByRole("button", { name: /Sign in with GitHub/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign in with Google/i })).toBeVisible();
});

test("nested admin routes are gated, including signin-prefixed paths", async ({ page }) => {
  // Regression: a loose (?!signin) matcher left /admin/signin-anything open.
  for (const path of ["/admin/jobs", "/admin/signin-backdoor", "/admin/a/b"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/signin/);
  }
});

test("admin is not advertised in the public navigation", async ({ page }) => {
  await page.goto("/");
  await expect(primaryNav(page).getByRole("link", { name: /admin/i })).toHaveCount(0);
});

test("an access-denied sign-in shows the allowlist message", async ({ page }) => {
  // The admin gate redirects here with ?error=AccessDenied when a signed-in
  // account is not the owner's.
  await page.goto("/admin/signin?error=AccessDenied");
  await expect(page.getByText(/not on the admin allowlist/i)).toBeVisible();
});
