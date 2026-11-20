import { describe, expect, it } from "vitest";

import {
  clientIpFrom,
  feedbackHref,
  isFeedbackKind,
  parseFeedbackKind,
  parseFeedbackPage,
} from "@/lib/feedback";

describe("feedback kinds", () => {
  it("accepts the four kinds and falls back to other", () => {
    expect(isFeedbackKind("data")).toBe(true);
    expect(isFeedbackKind("rant")).toBe(false);
    expect(parseFeedbackKind("bug")).toBe("bug");
    expect(parseFeedbackKind(["idea", "bug"])).toBe("idea");
    expect(parseFeedbackKind("rant")).toBe("other");
    expect(parseFeedbackKind(undefined)).toBe("other");
  });
});

describe("parseFeedbackPage", () => {
  it("keeps same-site paths and drops anything that leaves the site", () => {
    expect(parseFeedbackPage("/players/stephen-curry?tab=log")).toBe(
      "/players/stephen-curry?tab=log"
    );
    expect(parseFeedbackPage(["/teams", "/data"])).toBe("/teams");
    expect(parseFeedbackPage("/")).toBe("/");
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "data"]) {
      expect(parseFeedbackPage(bad)).toBeNull();
    }
    expect(parseFeedbackPage(undefined)).toBeNull();
    expect(parseFeedbackPage("")).toBeNull();
  });

  it("cuts a long path to what the API stores", () => {
    expect(parseFeedbackPage("/" + "a".repeat(900))).toHaveLength(512);
  });
});

describe("clientIpFrom", () => {
  it("takes the first forwarded address, then the real-ip header", () => {
    expect(clientIpFrom("203.0.113.7, 10.0.0.2", null)).toBe("203.0.113.7");
    expect(clientIpFrom(" 2001:db8::1 ", "10.0.0.2")).toBe("2001:db8::1");
    expect(clientIpFrom(null, " 198.51.100.4 ")).toBe("198.51.100.4");
    expect(clientIpFrom("", "")).toBeNull();
    expect(clientIpFrom(null, null)).toBeNull();
  });
});

describe("feedbackHref", () => {
  it("links to the form with the kind and, when given, the page", () => {
    expect(feedbackHref("data", "/data")).toBe("/feedback?kind=data&from=%2Fdata");
    expect(feedbackHref("bug")).toBe("/feedback?kind=bug");
  });
});
