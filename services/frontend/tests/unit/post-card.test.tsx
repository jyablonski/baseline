import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listSocialPostComments = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: { listSocialPostComments },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import { Providers } from "@/components/providers";
import { FeedHeader, PostCard } from "@/components/social/post-card";
import type { SocialComment, SocialPost } from "@/lib/types";

const post = {
  reddit_id: "p1",
  subreddit: "nba",
  title: "Steve Kerr staring at the board",
  author: "MrBuckBuck",
  score: 24,
  num_comments: 7,
  created_utc: "2026-10-08T01:00:00Z",
  permalink: "https://www.reddit.com/r/nba/comments/p1/",
  url: "https://streamable.com/x",
  flair: null,
  is_self: false,
  scraped_at: "2026-10-08T08:18:00Z",
  tag: null,
  source: "streamable.com",
  content_type: "link",
  is_contested: false,
  discussion_ratio: 0.3,
  captured_comment_count: 2,
  top_comment_score: 41,
  captured_comment_score: 60,
  top_comment_leverage: null,
  comment_concentration: null,
  player_mentions: [],
  team_mentions: [],
  author_flair: null,
  flair_scope: null,
  flair_team_abbreviation: null,
  flair_team_name: null,
} as unknown as SocialPost;

function comment(overrides: Partial<SocialComment>): SocialComment {
  return {
    reddit_id: "c1",
    post_reddit_id: "p1",
    parent_id: "t3_p1",
    author: "sample_one",
    body: "Number 7 is the only one here that is actually cold.",
    score: 41,
    created_utc: "2026-10-08T02:00:00Z",
    permalink: "https://reddit.com/c1",
    is_top_level: true,
    is_removed: false,
    author_flair: null,
    flair_scope: null,
    flair_team_abbreviation: null,
    flair_team_name: null,
    ...overrides,
  } as SocialComment;
}

function renderCard(overrides: Partial<SocialPost> = {}, defaultOpen = false) {
  return render(
    <Providers>
      <PostCard post={{ ...post, ...overrides }} defaultOpen={defaultOpen} />
    </Providers>
  );
}

describe("feed row", () => {
  beforeEach(() => {
    listSocialPostComments.mockReset();
    listSocialPostComments.mockResolvedValue({
      data: [comment({})],
      meta: { total: 1, limit: 1, offset: 0 },
    });
  });

  it("labels the columns once in the header, with the count and sort", () => {
    const { rerender } = render(<FeedHeader total={1579} sortLabel="most recent" />);
    expect(screen.getByRole("heading", { name: "Feed" })).toBeInTheDocument();
    expect(screen.getByText("1,579 posts · most recent")).toBeInTheDocument();
    expect(screen.getByText("Score")).toBeInTheDocument();
    expect(screen.getByText("Comments")).toBeInTheDocument();

    rerender(<FeedHeader total={3} />);
    expect(screen.getByText("3 posts")).toBeInTheDocument();
  });

  it("sets only scores of 100 and up in the accent colour", () => {
    const { unmount } = renderCard({ score: 99 });
    expect(screen.getByText("99")).not.toHaveClass("text-primary");
    unmount();

    renderCard({ score: 100, num_comments: 7 });
    expect(screen.getByText("100")).toHaveClass("text-primary");
    // The comment count never takes the accent, however large.
    expect(screen.getByText("7")).not.toHaveClass("text-primary");
  });

  it("leaves out what a post does not have: flair, tag, mentions, comments", () => {
    renderCard({ captured_comment_count: 0, author: null });
    expect(screen.getByText("u/author unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/ fan$/)).not.toBeInTheDocument();
    expect(screen.queryByText("Contested")).not.toBeInTheDocument();
    // Nothing was captured, so there is nothing to expand; the thread link stays.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Thread ↗" })).toHaveAttribute(
      "href",
      "https://www.reddit.com/r/nba/comments/p1/"
    );
    expect(listSocialPostComments).not.toHaveBeenCalled();
  });

  it("shows flair, an unknown type as sent, and caps mentions at three", () => {
    renderCard({
      content_type: "mystery",
      flair_scope: "team",
      flair_team_abbreviation: "POR",
      player_mentions: ["Chris Paul", "Draymond Green", "Rudy Gobert", "Kel'el Ware"],
      team_mentions: ["Utah Jazz"],
    });
    expect(screen.getByText("mystery")).toBeInTheDocument();
    expect(screen.getByText("POR fan")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rudy Gobert" })).toHaveAttribute(
      "href",
      "/players/rudy-gobert"
    );
    expect(screen.queryByRole("link", { name: "Kel'el Ware" })).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("fetches comments only once opened, and can start open", async () => {
    renderCard();
    expect(listSocialPostComments).not.toHaveBeenCalled();
    const toggle = screen.getByRole("button", { name: "Top comments (2)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(await screen.findByText(/actually cold/)).toBeInTheDocument();
    expect(listSocialPostComments).toHaveBeenCalledWith("p1");
    expect(screen.getByRole("button", { name: "Hide comments" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("marks replies, removed comments, and a commenter's flair", async () => {
    listSocialPostComments.mockResolvedValue({
      data: [
        comment({ flair_scope: "league" }),
        comment({ reddit_id: "c2", is_top_level: false, body: "A reply.", author: "sample_two" }),
        comment({ reddit_id: "c3", is_removed: true, author: null, body: "[removed]" }),
      ],
      meta: { total: 3, limit: 3, offset: 0 },
    });
    renderCard({}, true);
    expect(await screen.findByText("r/NBA fan")).toBeInTheDocument();
    expect(screen.getByText("A reply.").closest("li")).toHaveClass("ml-[var(--ct-space-4)]");
    expect(screen.getByText(/actually cold/).closest("li")).not.toHaveClass(
      "ml-[var(--ct-space-4)]"
    );
    expect(screen.getByText(/deleted or removed before collection/)).toBeInTheDocument();
    expect(screen.queryByText("[removed]")).not.toBeInTheDocument();
    expect(screen.getByText("author unavailable")).toHaveClass("italic");
    // Exactly the preview size: nothing is held back.
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  });

  it("says so when the comments request fails or comes back empty", async () => {
    listSocialPostComments.mockRejectedValue(new Error("Warehouse unavailable"));
    const { unmount } = renderCard({}, true);
    // The query retries once, a second later, before it reports the failure.
    expect(
      await screen.findByText("Warehouse unavailable", {}, { timeout: 4000 })
    ).toBeInTheDocument();
    unmount();

    listSocialPostComments.mockResolvedValue({
      data: [],
      meta: { total: 0, limit: 0, offset: 0 },
    });
    renderCard({ reddit_id: "p2" }, true);
    expect(await screen.findByText("No comments were captured for this post.")).toBeInTheDocument();
  });
});
