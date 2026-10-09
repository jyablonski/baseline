import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The account server actions import the NextAuth config, which cannot load
// under jsdom. Every page that offers picks or chat reaches them, so the
// default here is a signed-out visitor; a test that needs more mocks it again.
vi.mock("@/app/account/actions", () => {
  const signedOut = async () => ({ ok: false, message: "Sign in to do that." });
  return {
    getProfileAction: signedOut,
    getPickSheetAction: signedOut,
    savePickAction: signedOut,
    removePickAction: signedOut,
    chatAction: signedOut,
    deleteAccountAction: signedOut,
    signOutAction: async () => {},
  };
});
