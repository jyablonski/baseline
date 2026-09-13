"use client";

import { Suspense, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { SocialControls, SummaryStrip } from "@/components/social/chrome";
import { PostCard } from "@/components/social/post-card";
import { EntityBoard, FanbaseBoard, LeaderBoard, Panel } from "@/components/social/panels";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { useSocialFilters } from "@/hooks/use-social-filters";
import { api, queryErrorMessage } from "@/lib/api";
import { SOCIAL_SORTS, formatCount, rangeToDates } from "@/lib/social";

const FEED_LIMIT = 5;

export default function SocialPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading social…" />}>
      <SocialBody />
    </Suspense>
  );
}

function SocialBody() {
  const { range, contentType, sort, setRange, setContentType, setSort } = useSocialFilters();

  // One date window for every panel, so nothing on the page disagrees about
  // "now". Named to avoid shadowing the global `window` in a client component.
  const dateWindow = useMemo(() => rangeToDates(range), [range]);

  const summaryQuery = useQuery({
    queryKey: ["social-summary", dateWindow],
    queryFn: () => api.getSocialSummary(dateWindow),
  });
  const facetsQuery = useQuery({
    queryKey: ["social-facets", dateWindow],
    queryFn: () => api.listSocialFacets(dateWindow),
  });
  const feedQuery = useQuery({
    queryKey: ["social-posts", dateWindow, contentType, sort],
    queryFn: () =>
      api.listSocialPosts({
        ...dateWindow,
        content_type: contentType || undefined,
        sort,
        limit: FEED_LIMIT,
      }),
  });
  const contestedQuery = useQuery({
    queryKey: ["social-contested", dateWindow],
    queryFn: () =>
      api.listSocialPosts({ ...dateWindow, contested: true, sort: "comments", limit: 1 }),
  });
  const playersQuery = useQuery({
    queryKey: ["social-players", dateWindow],
    queryFn: () => api.listSocialEntities("player", dateWindow),
  });
  const teamsQuery = useQuery({
    queryKey: ["social-teams", dateWindow],
    queryFn: () => api.listSocialEntities("team", dateWindow),
  });
  const fanbasesQuery = useQuery({
    queryKey: ["social-fanbases", dateWindow],
    queryFn: () => api.listSocialFanbases({ ...dateWindow, limit: 12 }),
  });
  const tagsQuery = useQuery({
    queryKey: ["social-tags", dateWindow],
    queryFn: () => api.listSocialBoard("tags", { ...dateWindow, limit: 8 }),
  });
  const sourcesQuery = useQuery({
    queryKey: ["social-sources", dateWindow],
    queryFn: () => api.listSocialBoard("sources", { ...dateWindow, limit: 8 }),
  });

  const summary = summaryQuery.data;
  const posts = feedQuery.data?.data ?? [];
  const contested = contestedQuery.data?.data ?? [];
  const players = playersQuery.data?.data ?? [];

  return (
    <div className="space-y-[var(--ct-space-5)]">
      <header>
        <h1 className="type-page">Social</h1>
        {/* No max-width: the strapline reads as one line at full width and still
            wraps on a narrow viewport. */}
        <p className="type-prose mt-1 text-ink-2">
          What r/nba is talking about. Posts and their ten highest-scoring comments, collected once
          a day.
        </p>
      </header>

      <SummaryStrip summary={summary} topPlayer={players[0]} mostContested={contested[0]} />

      <div>
        <SocialControls
          range={range}
          onRange={setRange}
          contentType={contentType}
          onContentType={setContentType}
          sort={sort}
          onSort={setSort}
          facets={facetsQuery.data?.data ?? []}
        />

        <div className="grid gap-[var(--ct-space-5)] lg:grid-cols-[minmax(0,1fr)_320px]">
          <section>
            <div className="flex items-baseline justify-between gap-2 border-b border-rule px-[var(--ct-space-2)] py-[var(--ct-space-2)]">
              <h2 className="type-module">Feed</h2>
              <span className="type-caption">
                {formatCount(feedQuery.data?.meta.total ?? 0)} posts ·{" "}
                {SOCIAL_SORTS.find((item) => item.key === sort)?.label.toLowerCase()}
              </span>
            </div>

            {feedQuery.isLoading ? (
              <LoadingState label="Loading posts…" />
            ) : feedQuery.isError ? (
              <ErrorState message={queryErrorMessage(feedQuery.error)} />
            ) : posts.length === 0 ? (
              <EmptyState
                title="Nothing collected in this range"
                message="r/nba was quiet in this range, or nothing has been collected for these days yet."
              />
            ) : (
              <div>
                {posts.map((post) => (
                  <PostCard key={post.reddit_id} post={post} />
                ))}
              </div>
            )}
          </section>

          <aside className="space-y-[var(--ct-space-4)]">
            <Panel
              title="Team mentions"
              meta={range}
              note="Nicknames, city names and common shorthand all count."
            >
              <EntityBoard
                rows={(teamsQuery.data?.data ?? []).slice(0, 8)}
                unit="Team"
                emptyMessage="No team mentions in this range."
              />
            </Panel>

            <Panel
              title="Fanbase comments"
              meta={range}
              note="From r/nba user flair, across posts and comments."
            >
              <FanbaseBoard rows={fanbasesQuery.data?.data ?? []} />
            </Panel>
          </aside>
        </div>
      </div>

      <div className="grid gap-[var(--ct-space-4)] lg:grid-cols-2">
        <Panel title="Reporters" note="From bracket prefixes in post titles.">
          <LeaderBoard
            rows={tagsQuery.data?.data ?? []}
            unit="Tag"
            emptyMessage="No bracket tags in this range."
          />
        </Panel>
        <Panel title="Where posts point" note="Self posts are collapsed to a single bucket.">
          <LeaderBoard
            rows={sourcesQuery.data?.data ?? []}
            unit="Source"
            emptyMessage="No posts in this range."
          />
        </Panel>
      </div>

      <section className="border border-rule bg-tint px-[var(--ct-space-4)] py-[var(--ct-space-3)]">
        <h2 className="type-eyebrow">What this page cannot tell you</h2>
        <ul className="type-caption mt-2 list-disc space-y-1 pl-5">
          <li>
            Whether a post is rising or already cooling. There is one snapshot per post and no score
            history.
          </li>
          <li>Full thread sentiment or reply depth beyond the ten comments captured per post.</li>
          <li>
            Which player a post means when it says only “Jokic”, “Kawhi” or “Wemby”. Matching needs
            the full name, because the player dimension holds only current players and would read
            “Jordan” as the wrong person.
          </li>
          <li>
            Anything before collection started. Posts stored before flair ingest shipped carry no
            user flair either, because Reddit only reports an author’s current badge.
          </li>
        </ul>
      </section>
    </div>
  );
}
