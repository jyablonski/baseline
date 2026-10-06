import { describe, expect, it } from "vitest";

import { decodeRouteSlug, isNavActive, PRIMARY_NAV, slugifyName, withSeason } from "@/lib/nav";

describe("nav", () => {
  it("lists primary tabs including Ask", () => {
    expect(PRIMARY_NAV.map((item) => item.label)).toEqual([
      "Home",
      "Schedule",
      "Players",
      "Teams",
      "Ask",
      "Social",
      "About",
    ]);
  });

  it("keeps profiles and compare under the Players tab", () => {
    expect(isNavActive("/players/202695", "/players")).toBe(true);
    expect(isNavActive("/players/compare", "/players")).toBe(true);
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/ask", "/ask")).toBe(true);
    expect(isNavActive("/teams/1", "/teams")).toBe(true);
    expect(isNavActive("/games/0022400001", "/games")).toBe(true);
    expect(isNavActive("/games", "/games")).toBe(true);
    expect(isNavActive("/schedule", "/schedule")).toBe(true);
    expect(isNavActive("/schedule", "/games")).toBe(false);
  });

  it("decodes a route slug so an accented name still matches its player", () => {
    const fromRoute = decodeRouteSlug("nikola-joki%C4%87");
    expect(fromRoute).toBe("nikola-jokić");
    expect(slugifyName(fromRoute)).toBe(slugifyName("Nikola Jokić"));
    expect(decodeRouteSlug("stephen-curry")).toBe("stephen-curry");
    // Not a valid escape: left as written instead of throwing.
    expect(decodeRouteSlug("100%")).toBe("100%");
  });

  it("appends season to links", () => {
    expect(withSeason("/players", "2025-26")).toBe("/players?season=2025-26");
    expect(withSeason("/players?search=kawhi", "2025-26")).toBe(
      "/players?search=kawhi&season=2025-26"
    );
    expect(withSeason("/ask", "")).toBe("/ask");
  });
});
