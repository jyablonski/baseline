import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/social",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const emptyPage = { data: [], meta: { total: 0, limit: 25, offset: 0 } };

vi.mock("@/lib/api", () => ({
  api: {
    getStatus: async () => ({ last_scraped_at: null, next_scrape_at: null }),
    getSocialSummary: async () => ({
      post_count: 0,
      author_count: 0,
      reported_comment_count: 0,
      captured_comment_count: 0,
      contested_post_count: 0,
      total_score: 0,
      top_score: null,
      first_post_at: null,
      last_post_at: null,
      last_scraped_at: null,
    }),
    listSocialFacets: async () => emptyPage,
    listSocialPosts: async () => emptyPage,
    listSocialPostComments: async () => emptyPage,
    listSocialEntities: async () => emptyPage,
    listSocialFanbases: async () => emptyPage,
    listSocialBoard: async () => emptyPage,
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import SocialPage from "@/app/social/page";
import { Providers } from "@/components/providers";

describe("social page with nothing collected", () => {
  it("explains the quiet range instead of looking broken", async () => {
    render(
      <Providers>
        <SocialPage />
      </Providers>
    );
    expect(await screen.findByText(/nothing collected in this range/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing has been collected for these days yet/i)).toBeInTheDocument();
    expect(await screen.findByText(/no team mentions in this range/i)).toBeInTheDocument();
    expect(screen.queryByText(/no full-name matches in this range/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/no user flair collected/i)).toBeInTheDocument();
    // The summary strip still renders, with honest zeroes.
    expect(screen.getByText(/top 10 per post, of 0 posted/i)).toBeInTheDocument();
  });
});
