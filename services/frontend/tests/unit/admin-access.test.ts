import { describe, expect, it } from "vitest";

import { adminJobsEnabled, allowedLogins, isAllowedLogin } from "@/lib/admin-access";

describe("admin allowlist", () => {
  it("fails closed when ADMIN_GITHUB_LOGINS is unset or empty", () => {
    // The important case: a missing variable must not mean "allow everyone".
    expect(isAllowedLogin("jyablonski", undefined)).toBe(false);
    expect(isAllowedLogin("jyablonski", "")).toBe(false);
    expect(isAllowedLogin("jyablonski", "   ")).toBe(false);
    expect(isAllowedLogin("jyablonski", ",,")).toBe(false);
  });

  it("admits only listed logins", () => {
    expect(isAllowedLogin("jyablonski", "jyablonski")).toBe(true);
    expect(isAllowedLogin("someone-else", "jyablonski")).toBe(false);
  });

  it("is case insensitive and tolerates whitespace", () => {
    expect(isAllowedLogin("JYablonski", " jyablonski ")).toBe(true);
    expect(isAllowedLogin("jyablonski", "OtherUser, JYABLONSKI")).toBe(true);
  });

  it("rejects empty or missing logins", () => {
    expect(isAllowedLogin(null, "jyablonski")).toBe(false);
    expect(isAllowedLogin(undefined, "jyablonski")).toBe(false);
    expect(isAllowedLogin("", "jyablonski")).toBe(false);
  });

  it("does not treat a substring as a match", () => {
    expect(isAllowedLogin("jyab", "jyablonski")).toBe(false);
    expect(isAllowedLogin("jyablonski2", "jyablonski")).toBe(false);
  });

  it("parses a comma separated list", () => {
    expect(allowedLogins("a, B ,,c")).toEqual(["a", "b", "c"]);
    expect(allowedLogins(undefined)).toEqual([]);
  });
});

describe("adminJobsEnabled", () => {
  it("is off unless explicitly set to true", () => {
    expect(adminJobsEnabled(undefined)).toBe(false);
    expect(adminJobsEnabled("")).toBe(false);
    expect(adminJobsEnabled("1")).toBe(false);
    expect(adminJobsEnabled("false")).toBe(false);
    expect(adminJobsEnabled("true")).toBe(true);
  });
});
