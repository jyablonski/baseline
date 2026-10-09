export const STUB_API_PORT = 8100;
export const STUB_API_URL = `http://127.0.0.1:${STUB_API_PORT}`;

// Fixed, public values. Nothing here is a credential for any deployment: the
// stub API and the Playwright dev server are the only things that ever see them.
export const E2E = {
  authSecret: "playwright-e2e-secret-not-used-by-any-deployment",
  accountsToken: "playwright-e2e-accounts-token",
  adminToken: "playwright-e2e-admin-token",
  ownerLogin: "e2e-owner",
  ownerEmail: "owner@e2e.test",
} as const;
