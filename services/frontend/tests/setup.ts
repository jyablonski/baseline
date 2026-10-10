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
    setTimezoneAction: signedOut,
    getPickSheetAction: signedOut,
    savePickAction: signedOut,
    removePickAction: signedOut,
    chatAction: signedOut,
    deleteAccountAction: signedOut,
    signOutAction: async () => {},
  };
});

// jsdom's selector engine answers `:fullscreen` by calling `matches` on the same
// element again, recursing until the stack overflows (tens of seconds per call).
// Base UI asks it of every open popover. Nothing is fullscreen under jsdom.
const matches = Element.prototype.matches;
Element.prototype.matches = function (selector: string) {
  return selector === ":fullscreen" ? false : matches.call(this, selector);
};
