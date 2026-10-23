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
  previousWindow,
  risingEntity,
} from "@/lib/social";
import type { SocialEntity, SocialPost } from "@/lib/types";

describe("social helpers", () => {
  it("accepts only the ranges the control row offers", () => {
    for (const range of SOCIAL_RANGES) expect(isSocialRange(range.key)).toBe(true);
    expect(isSocialRange("all-time")).toBe(false);
    expect(isSocialRange(null)).toBe(false);
  });

  it("builds inclusive UTC day bounds", () => {
    const anchor = new Date("2026-09-11T03:50:00Z");
    // The anchor day is partial, so 24h reaches back through the whole day before it.
    expect(rangeToDates("24h", anchor)).toEqual({
      from_date: "2026-09-10",
      to_date: "2026-09-11",
    });
    expect(rangeToDates("7d", anchor)).toEqual({
      from_date: "2026-09-04",
      to_date: "2026-09-11",
    });
    // Crossing a month boundary must not clamp to the 1st.
    expect(rangeToDates("30d", new Date("2026-03-05T00:00:00Z")).from_date).toBe("2026-02-03");
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

describe("previousWindow", () => {
  it("is the same length, ending the day before the window starts", () => {
    expect(previousWindow({ from_date: "2026-09-10", to_date: "2026-09-11" })).toEqual({
      from_date: "2026-09-08",
      to_date: "2026-09-09",
    });
    expect(previousWindow({ from_date: "2026-09-04", to_date: "2026-09-11" })).toEqual({
      from_date: "2026-08-27",
      to_date: "2026-09-03",
    });
    // Across a month and a year end.
    expect(previousWindow({ from_date: "2026-01-01", to_date: "2026-01-02" })).toEqual({
      from_date: "2025-12-30",
      to_date: "2025-12-31",
    });
  });
});

describe("risingEntity", () => {
  const entity = (entity_id: string, post_count: number): SocialEntity => ({
    entity_id,
    entity_name: entity_id,
    entity_abbreviation: null,
    post_count,
    comment_count: 0,
    total_post_score: 0,
    top_post_score: null,
    primary_color: null,
    alternate_color: null,
  });

  it("picks the biggest gain across players and teams, and says which it is", () => {
    const rising = risingEntity(
      [
        { kind: "player", entities: [entity("brown", 12), entity("tatum", 5)] },
        { kind: "team", entities: [entity("celtics", 20)] },
      ],
      [entity("brown", 10), entity("tatum", 1), entity("celtics", 19)]
    );
    expect(rising).toMatchObject({ kind: "player", gain: 4, previous: 1 });
    expect(rising?.entity.entity_id).toBe("tatum");
  });

  it("counts a name missing from the window before as a rise from zero", () => {
    const rising = risingEntity(
      [{ kind: "team", entities: [entity("knicks", 3)] }],
      [entity("celtics", 8)]
    );
    expect(rising).toMatchObject({ gain: 3, previous: 0, kind: "team" });
  });

  it("breaks a tied gain on the bigger count now", () => {
    const rising = risingEntity(
      [{ kind: "player", entities: [entity("small", 3), entity("big", 9)] }],
      [entity("small", 1), entity("big", 7)]
    );
    expect(rising?.entity.entity_id).toBe("big");
  });

  it("is null when nothing grew, or when there is nothing to compare with", () => {
    expect(
      risingEntity([{ kind: "player", entities: [entity("a", 5)] }], [entity("a", 5)])
    ).toBeNull();
    expect(
      risingEntity([{ kind: "player", entities: [entity("a", 5)] }], [entity("a", 9)])
    ).toBeNull();
    // An empty window before is a gap in collection, not a surge.
    expect(risingEntity([{ kind: "player", entities: [entity("a", 5)] }], [])).toBeNull();
  });
});
