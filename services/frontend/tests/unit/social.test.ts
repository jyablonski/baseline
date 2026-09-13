import { describe, expect, it } from "vitest";

import {
  SOCIAL_RANGES,
  facetCount,
  flairLabel,
  formatCount,
  isSocialRange,
  postSourceLabel,
  rangeToDates,
  relativeAge,
  totalFacetCount,
} from "@/lib/social";
import type { SocialPost } from "@/lib/types";

describe("social helpers", () => {
  it("accepts only the ranges the control row offers", () => {
    for (const range of SOCIAL_RANGES) expect(isSocialRange(range.key)).toBe(true);
    expect(isSocialRange("all-time")).toBe(false);
    expect(isSocialRange(null)).toBe(false);
  });

  it("builds inclusive UTC day bounds", () => {
    const today = new Date("2026-09-11T18:30:00Z");
    expect(rangeToDates("24h", today)).toEqual({
      from_date: "2026-09-11",
      to_date: "2026-09-11",
    });
    expect(rangeToDates("7d", today)).toEqual({
      from_date: "2026-09-05",
      to_date: "2026-09-11",
    });
    // Crossing a month boundary must not clamp to the 1st.
    expect(rangeToDates("30d", new Date("2026-03-05T00:00:00Z")).from_date).toBe("2026-02-04");
  });

  it("renders missing numbers as a placeholder rather than NaN", () => {
    expect(formatCount(18204)).toBe("18,204");
    expect(formatCount(null)).toBe("—");
  });

  it("ages a batch in hours then days", () => {
    const now = new Date("2026-09-11T12:00:00Z");
    expect(relativeAge("2026-09-11T11:40:00Z", now)).toBe("under 1h ago");
    expect(relativeAge("2026-09-11T02:00:00Z", now)).toBe("10h ago");
    expect(relativeAge("2026-09-08T12:00:00Z", now)).toBe("3d ago");
    expect(relativeAge(null, now)).toBe("—");
    expect(relativeAge("not-a-date", now)).toBe("—");
  });

  it("counts facets, including types the API did not return", () => {
    const facets = [
      { key: "discussion", post_count: 15, contested_post_count: 5 },
      { key: "highlight", post_count: 12, contested_post_count: 0 },
    ];
    expect(facetCount(facets, "highlight")).toBe(12);
    expect(facetCount(facets, "link")).toBe(0);
    expect(totalFacetCount(facets)).toBe(27);
  });

  it("shows a fan badge only when the flair resolved to a club", () => {
    expect(flairLabel({ flair_scope: "team", flair_team_abbreviation: "LAL" })).toBe("LAL");
    expect(flairLabel({ flair_scope: "team", flair_team_name: "Los Angeles Lakers" })).toBe(
      "Los Angeles Lakers"
    );
    expect(flairLabel({ flair_scope: "league" })).toBe("r/NBA");
    // A country or joke flair is not a fanbase, and neither is no flair at all.
    expect(flairLabel({ flair_scope: "other" })).toBeNull();
    expect(flairLabel({})).toBeNull();
  });

  it("names where a post points", () => {
    const post = { source: "self" } as SocialPost;
    expect(postSourceLabel(post)).toBe("Self post");
    expect(postSourceLabel({ source: "streamable.com" } as SocialPost)).toBe("streamable.com");
    expect(postSourceLabel({ source: null } as SocialPost)).toBe("No link");
  });
});
