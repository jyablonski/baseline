import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/social",
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => new URLSearchParams(),
}));

const contestedPost = {
  reddit_id: "zero1",
  subreddit: "nba",
  title: "Most overrated players?",
  author: "throwaway_hoopshead",
  score: 0,
  num_comments: 132,
  created_utc: "2026-09-09T05:29:22Z",
  permalink: "https://www.reddit.com/r/nba/comments/zero1/",
  url: null,
  flair: null,
  is_self: true,
  scraped_at: "2026-09-11T06:00:00Z",
  tag: null,
  source: "self",
  content_type: "discussion",
  is_contested: true,
  discussion_ratio: 132,
  captured_comment_count: 3,
  top_comment_score: 284,
  captured_comment_score: 600,
  top_comment_leverage: null,
  comment_concentration: null,
  player_mentions: ["Jaylen Brown", "Trae Young"],
  team_mentions: ["Boston Celtics"],
  author_flair: ":bos-1: Celtics",
  flair_scope: "team",
  flair_team_abbreviation: "BOS",
  flair_team_name: "Boston Celtics",
};

vi.mock("@/lib/api", () => ({
  api: {
    getStatus: async () => ({ last_scraped_at: "2026-09-11T06:00:00Z", next_scrape_at: null }),
    getSocialSummary: async () => ({
      post_count: 41,
      author_count: 33,
      reported_comment_count: 18204,
      captured_comment_count: 402,
      contested_post_count: 5,
      total_score: 120544,
      top_score: 12817,
      first_post_at: "2026-09-04T00:00:00Z",
      last_post_at: "2026-09-11T05:29:41Z",
      last_scraped_at: "2026-09-11T06:00:00Z",
    }),
    listSocialFacets: async () => ({
      data: [
        { key: "discussion", post_count: 15, contested_post_count: 5 },
        { key: "highlight", post_count: 12, contested_post_count: 0 },
      ],
      meta: { total: 2, limit: 2, offset: 0 },
    }),
    listSocialPosts: async (params: { contested?: boolean }) => ({
      data: [contestedPost],
      meta: { total: params?.contested ? 5 : 41, limit: 25, offset: 0 },
    }),
    listSocialPostComments: async () => ({
      data: [
        {
          reddit_id: "c1",
          post_reddit_id: "zero1",
          parent_id: "t3_zero1",
          author: "DeadEyeDuncan21",
          body: "Anyone whose case is built on a single conference finals run.",
          score: 284,
          created_utc: "2026-09-09T06:00:00Z",
          permalink: "https://reddit.com/c1",
          is_top_level: true,
          is_removed: false,
          author_flair: null,
          flair_scope: null,
          flair_team_abbreviation: null,
          flair_team_name: null,
        },
        {
          reddit_id: "c2",
          post_reddit_id: "zero1",
          parent_id: "t1_c1",
          author: null,
          body: "[removed]",
          score: 142,
          created_utc: "2026-09-09T06:10:00Z",
          permalink: "https://reddit.com/c2",
          is_top_level: false,
          is_removed: true,
          author_flair: null,
          flair_scope: null,
          flair_team_abbreviation: null,
          flair_team_name: null,
        },
        {
          reddit_id: "c3",
          post_reddit_id: "zero1",
          parent_id: "t3_zero1",
          author: "bench_mob_3",
          body: "Third on the list, first in our hearts.",
          score: 90,
          created_utc: "2026-09-09T06:20:00Z",
          permalink: "https://reddit.com/c3",
          is_top_level: true,
          is_removed: false,
          author_flair: null,
          flair_scope: null,
          flair_team_abbreviation: null,
          flair_team_name: null,
        },
        {
          reddit_id: "c4",
          post_reddit_id: "zero1",
          parent_id: "t3_zero1",
          author: "bench_mob_4",
          body: "Saving this to check back in April.",
          score: 41,
          created_utc: "2026-09-09T06:20:00Z",
          permalink: "https://reddit.com/c4",
          is_top_level: true,
          is_removed: false,
          author_flair: null,
          flair_scope: null,
          flair_team_abbreviation: null,
          flair_team_name: null,
        },
      ],
      meta: { total: 4, limit: 4, offset: 0 },
    }),
    listSocialEntities: async (entityType: string) => ({
      data: [
        {
          entity_id: `${entityType}-1`,
          entity_name: entityType === "player" ? "Kawhi Leonard" : "LA Clippers",
          entity_abbreviation: entityType === "team" ? "LAC" : null,
          entity_nickname: entityType === "team" ? "Clippers" : null,
          post_count: 9,
          comment_count: 63,
          total_post_score: 41022,
          top_post_score: 12817,
          primary_color: entityType === "team" ? "#C8102E" : null,
          alternate_color: null,
        },
      ],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    listSocialFanbases: async () => ({
      data: [
        {
          flair_scope: "team",
          flair_team_id: "t1",
          flair_team_abbreviation: "LAL",
          flair_team_nickname: "Lakers",
          label: "Los Angeles Lakers",
          document_count: 84,
          post_count: 9,
          comment_count: 75,
          author_count: 61,
          primary_color: "#552583",
          alternate_color: null,
        },
      ],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    listSocialBoard: async (board: string) => ({
      data:
        board === "composition"
          ? [
              {
                key: "self",
                post_count: 104,
                self_post_count: 104,
                link_post_count: 0,
                total_score: 1,
                top_score: 1,
                avg_score: 38,
                median_score: 38,
                total_comments: 1,
                median_comments: 96,
                median_discussion_ratio: 2.53,
              },
              {
                key: "link",
                post_count: 183,
                self_post_count: 0,
                link_post_count: 183,
                total_score: 1,
                top_score: 1,
                avg_score: 412,
                median_score: 412,
                total_comments: 1,
                median_comments: 61,
                median_discussion_ratio: 0.15,
              },
            ]
          : [
              {
                key:
                  board === "tags"
                    ? "Charania"
                    : board === "sources"
                      ? "streamable.com"
                      : "MrBuckBuck",
                post_count: 14,
                self_post_count: 9,
                link_post_count: 5,
                total_score: 24108,
                top_score: 5000,
                avg_score: 1842,
                median_score: 1842,
                total_comments: 4000,
                median_comments: 318,
                median_discussion_ratio: 0.2,
              },
            ],
      meta: { total: 1, limit: 8, offset: 0 },
    }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import SocialPage from "@/app/social/page";
import { Providers } from "@/components/providers";
import { PostCard } from "@/components/social/post-card";

function renderPage() {
  return render(
    <Providers>
      <SocialPage />
    </Providers>
  );
}

describe("social page", () => {
  it("shows captured comments against the real thread total", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("402")).toBeInTheDocument());
    expect(screen.getByText("2% of 18,204 posted")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  });

  it("leaves the per-post ratio strip off feed cards", async () => {
    renderPage();
    const card = await screen.findByRole("article");
    // Score and comments are labelled once, in the feed header.
    expect(screen.getByText("Score", { selector: "span" })).toBeInTheDocument();
    expect(within(card).getByText("132")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Jaylen Brown" })).toHaveAttribute(
      "href",
      "/players/jaylen-brown"
    );
    expect(within(card).getByRole("link", { name: "Boston Celtics" })).toHaveAttribute(
      "href",
      "/teams/boston-celtics"
    );
    expect(within(card).getByRole("link", { name: "Thread ↗" })).toHaveAttribute(
      "href",
      "https://www.reddit.com/r/nba/comments/zero1/"
    );
    for (const gone of ["Discussion ratio", "Top-comment leverage", "Comment concentration"]) {
      expect(within(card).queryByText(gone)).not.toBeInTheDocument();
    }
    expect(within(card).queryByText("132.00")).not.toBeInTheDocument();
    expect(screen.getByText(/What r\/nba is talking about\./)).toBeInTheDocument();
  });

  it("names a bracket tag only when it differs from the post type", async () => {
    const reported = { ...contestedPost, content_type: "report", tag: "Charania" };
    const highlight = { ...contestedPost, content_type: "highlight", tag: "Highlight" };
    const { rerender } = render(
      <Providers>
        <PostCard post={reported} />
      </Providers>
    );
    expect(screen.getByText("Reporter")).toBeInTheDocument();
    expect(screen.getByText("Charania")).toBeInTheDocument();
    rerender(
      <Providers>
        <PostCard post={highlight} />
      </Providers>
    );
    expect(screen.getAllByText("Highlight")).toHaveLength(1);
  });

  it("keeps comments collapsed until asked, then previews the top few", async () => {
    renderPage();
    // Nothing is expanded on load; the count lives on the button instead.
    const toggle = await screen.findByRole("button", { name: "Top comments (3)" });
    expect(screen.queryByText(/single conference finals run/i)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(await screen.findByText(/single conference finals run/i)).toBeInTheDocument();
    expect(screen.getByText(/deleted or removed before collection/i)).toBeInTheDocument();
    expect(screen.getByText("author unavailable")).toBeInTheDocument();
    // The fourth captured row waits behind the preview.
    expect(screen.queryByText(/check back in April/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 4 captured comments" }));
    expect(screen.getByText(/check back in April/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide comments" }));
    expect(screen.queryByText(/single conference finals run/i)).not.toBeInTheDocument();
  });

  it("renders the rail, the boards, and the limits block", async () => {
    renderPage();
    // The top player still headlines the summary strip; the player board is gone.
    expect(await screen.findByText("Kawhi Leonard")).toBeInTheDocument();
    expect(screen.getAllByText("Kawhi Leonard")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Player mentions" })).not.toBeInTheDocument();
    // The rail shows the nickname so a long club name still fits.
    expect(await screen.findByText("Lakers")).toBeInTheDocument();
    expect(screen.queryByText("Los Angeles Lakers")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fanbase comments" })).toBeInTheDocument();
    // Team mentions use the nickname too, with no abbreviation beside it.
    const teams = screen.getByText("Team mentions").closest("section") as HTMLElement;
    expect(await within(teams).findByText("Clippers")).toBeInTheDocument();
    expect(within(teams).queryByText("LA Clippers")).not.toBeInTheDocument();
    expect(within(teams).queryByText("LAC")).not.toBeInTheDocument();
    // Removed panels stay removed.
    // Panel headings, not any occurrence: a card still badges a contested post.
    for (const gone of ["Posters", "Self posts against links", "Posting rhythm", "Contested"]) {
      expect(screen.queryByRole("heading", { name: gone })).not.toBeInTheDocument();
    }
    expect(screen.getByText("Contested")).toBeInTheDocument();
    expect(screen.queryByText(/what this page cannot tell you/i)).not.toBeInTheDocument();
  });

  it("puts the chosen filter in the URL so a view is shareable", async () => {
    replace.mockClear();
    renderPage();
    const highlight = await screen.findByRole("button", { name: /highlight 12/i });
    expect(screen.getByRole("button", { name: /discussion 15/i })).toBeInTheDocument();
    fireEvent.click(highlight);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/social?type=highlight"));

    fireEvent.click(screen.getByRole("button", { name: "24h" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/social?range=24h"));
  });
});
