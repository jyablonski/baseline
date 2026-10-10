import { describe, expect, it, vi } from "vitest";

import {
  adminJobsEnabled,
  allowedEmails,
  allowedLogins,
  isAdminUser,
  isAllowedLogin,
} from "@/lib/admin-access";

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

describe("isAdminUser", () => {
  const env = { logins: "jyablonski", emails: "jyablonski9@gmail.com" };

  it("admits the owner through either provider", () => {
    expect(isAdminUser({ provider: "github", login: "jyablonski" }, env)).toBe(true);
    expect(isAdminUser({ provider: "github", login: "JYablonski" }, env)).toBe(true);
    expect(
      isAdminUser({ provider: "google", email: "jyablonski9@gmail.com", verifiedEmail: true }, env)
    ).toBe(true);
    expect(
      isAdminUser({ provider: "google", email: "JYablonski9@Gmail.com", verifiedEmail: true }, env)
    ).toBe(true);
  });

  it("rejects every other signed-in account", () => {
    expect(isAdminUser({ provider: "github", login: "someone-else" }, env)).toBe(false);
    expect(
      isAdminUser({ provider: "google", email: "someone@gmail.com", verifiedEmail: true }, env)
    ).toBe(false);
    expect(isAdminUser(null, env)).toBe(false);
    expect(isAdminUser(undefined, env)).toBe(false);
    expect(isAdminUser({}, env)).toBe(false);
  });

  it("matches each provider on its own identifier only", () => {
    // The owner's address on a GitHub profile proves nothing here.
    expect(
      isAdminUser(
        {
          provider: "github",
          login: "someone-else",
          email: "jyablonski9@gmail.com",
          verifiedEmail: true,
        },
        env
      )
    ).toBe(false);
    // Nor does the owner's GitHub login on a Google session.
    expect(
      isAdminUser(
        { provider: "google", login: "jyablonski", email: "x@gmail.com", verifiedEmail: true },
        env
      )
    ).toBe(false);
    expect(isAdminUser({ provider: "twitter", login: "jyablonski" }, env)).toBe(false);
    expect(isAdminUser({ login: "jyablonski" }, env)).toBe(false);
  });

  it("requires Google to have verified the address", () => {
    for (const verifiedEmail of [false, undefined, null]) {
      expect(
        isAdminUser({ provider: "google", email: "jyablonski9@gmail.com", verifiedEmail }, env)
      ).toBe(false);
    }
    expect(isAdminUser({ provider: "google", verifiedEmail: true }, env)).toBe(false);
  });

  it("fails closed when either list is unset", () => {
    const owner = { provider: "google", email: "jyablonski9@gmail.com", verifiedEmail: true };
    expect(isAdminUser(owner, { logins: "jyablonski", emails: undefined })).toBe(false);
    expect(isAdminUser(owner, { logins: "jyablonski", emails: " , " })).toBe(false);
    expect(isAdminUser({ provider: "github", login: "jyablonski" }, { emails: "a@b.c" })).toBe(
      false
    );
    expect(allowedEmails(" A@b.c , ,d@e.f ")).toEqual(["a@b.c", "d@e.f"]);
    expect(allowedEmails(undefined)).toEqual([]);
  });

  it("reads the environment by default", () => {
    vi.stubEnv("ADMIN_GITHUB_LOGINS", "env-owner");
    vi.stubEnv("ADMIN_GOOGLE_EMAILS", "");
    expect(isAdminUser({ provider: "github", login: "env-owner" })).toBe(true);
    expect(isAdminUser({ provider: "google", email: "a@b.c", verifiedEmail: true })).toBe(false);
    vi.unstubAllEnvs();
  });
});
