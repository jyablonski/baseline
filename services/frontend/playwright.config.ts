import { defineConfig, devices } from "@playwright/test";

import { E2E, STUB_API_PORT, STUB_API_URL } from "./tests/e2e/e2e-env";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  webServer: [
    {
      // Stands in for FastAPI on the signed-in flows; see tests/e2e/stub-api.mjs.
      command: "node tests/e2e/stub-api.mjs",
      url: STUB_API_URL,
      reuseExistingServer: !process.env.CI,
      env: {
        STUB_API_PORT: String(STUB_API_PORT),
        ACCOUNTS_API_TOKEN: E2E.accountsToken,
        ADMIN_API_TOKEN: E2E.adminToken,
      },
    },
    {
      command: "npm run dev -- --port 3100 --hostname localhost",
      url: "http://localhost:3100",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        // NextAuth refuses to start without a secret, and without one the
        // /admin specs would pass because auth crashed rather than because
        // the gate rejected the visitor. The specs mint their own session
        // cookies with it, which is how a signed-in visitor is simulated
        // without a real OAuth round trip.
        AUTH_SECRET: E2E.authSecret,
        AUTH_URL: "http://localhost:3100",
        // One owner per provider, so the gate is tested against real
        // allowlists and not only against empty ones.
        ADMIN_GITHUB_LOGINS: E2E.ownerLogin,
        ADMIN_GOOGLE_EMAILS: E2E.ownerEmail,
        ADMIN_API_URL: STUB_API_URL,
        ADMIN_API_TOKEN: E2E.adminToken,
        ACCOUNTS_API_URL: STUB_API_URL,
        ACCOUNTS_API_TOKEN: E2E.accountsToken,
        // The specs that mock window.fetch never reach this; the signed-in
        // specs let the browser call the stub directly.
        NEXT_PUBLIC_API_URL: STUB_API_URL,
      },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
