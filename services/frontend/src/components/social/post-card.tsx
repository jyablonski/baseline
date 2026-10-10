"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { ErrorState, LoadingState } from "@/components/query-state";
import { api, queryErrorMessage } from "@/lib/api";
import { playerHref, teamHref } from "@/lib/nav";
import {
  CONTENT_TYPE_LABELS,
  flairLabel,
  formatCount,
  postSourceLabel,
  relativeAge,
} from "@/lib/social";
import type { SocialComment, SocialPost } from "@/lib/types";
import { cn } from "@/lib/utils";

// Feed rows and the feed header share one grid, so the two figures on the right
// sit under their column labels.
const FEED_GRID =
  "grid grid-cols-[minmax(0,1fr)_56px_84px] gap-x-[var(--ct-space-4)] px-[var(--ct-space-2)]";

// Scores from here up are set in the accent colour, so the posts that travelled
// stand out when scanning the column.
const HIGH_SCORE = 100;

const COMMENT_PREVIEW = 3;

export function FeedHeader({ total, sortLabel }: { total: number; sortLabel?: string }) {
  return (
    <div className={cn(FEED_GRID, "items-baseline border-b border-rule-strong py-2")}>
      <div className="flex items-baseline gap-[var(--ct-space-3)]">
        <h2 className="type-module">Feed</h2>
        <span className="type-caption">
          {formatCount(total)} posts{sortLabel ? ` · ${sortLabel}` : ""}
        </span>
      </div>
      <span className="type-eyebrow text-right">Score</span>
      <span className="type-eyebrow text-right">Comments</span>
    </div>
  );
}

export function FeedPager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (next: number) => void;
}) {
  if (total <= pageSize && page === 0) return null;
  const from = Math.min(total, page * pageSize + 1);
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex items-center justify-between px-[var(--ct-space-2)] py-[var(--ct-space-3)] text-sm">
      <p className="text-muted-foreground">
        {formatCount(from)}–{formatCount(to)} of {formatCount(total)} posts
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          className="btn-ghost"
        >
          ← Prev
        </button>
        <button
          type="button"
          disabled={to >= total}
          onClick={() => onPage(page + 1)}
          className="btn-ghost"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

export function PostCard({
  post,
  defaultOpen = false,
}: {
  post: SocialPost;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const flair = flairLabel(post);
  const typeLabel = CONTENT_TYPE_LABELS[post.content_type] ?? post.content_type;
  // A "[Highlight]" post is typed Highlight from that same bracket tag, so the
  // tag only earns a slot when it adds something, like a reporter's name.
  const tag = post.tag && post.tag.toLowerCase() !== typeLabel.toLowerCase() ? post.tag : null;
  return (
    <article className={cn(FEED_GRID, "border-b border-rule py-[var(--ct-space-4)]")}>
      <div className="min-w-0">
        <p className="type-caption flex flex-wrap items-center gap-x-2 gap-y-1">
          {post.is_contested ? <Tag tone="loss">Contested</Tag> : null}
          <span className="font-semibold text-ink-2">{typeLabel}</span>
          <Dot />
          <span>{postSourceLabel(post)}</span>
          {tag ? (
            <>
              <Dot />
              <span>{tag}</span>
            </>
          ) : null}
        </p>

        <h3 className="type-module mt-2 leading-snug">{post.title}</h3>

        <p className="type-caption mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>u/{post.author ?? "author unavailable"}</span>
          {flair ? (
            <>
              <Dot />
              <span>{flair} fan</span>
            </>
          ) : null}
          <Dot />
          <span>{relativeAge(post.created_utc)}</span>
          <Mentions post={post} />
        </p>

        <p className="mt-3 flex flex-wrap items-center gap-x-[var(--ct-space-4)] gap-y-1">
          {post.captured_comment_count > 0 ? (
            <button
              type="button"
              className="text-[length:var(--ct-fs-cell)] font-semibold text-primary hover:underline"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
            >
              {open ? "Hide comments" : `Top comments (${post.captured_comment_count})`}
            </button>
          ) : null}
          <a
            className="text-[length:var(--ct-fs-cell)] text-ink-3 hover:text-foreground"
            href={post.permalink}
            target="_blank"
            rel="noreferrer"
          >
            Thread ↗
          </a>
        </p>

        {open ? <CapturedComments post={post} /> : null}
      </div>

      <p
        className={cn(
          "type-stat tabular text-right leading-none",
          post.score >= HIGH_SCORE && "text-primary"
        )}
      >
        {formatCount(post.score)}
      </p>
      <p className="type-stat tabular text-right leading-none">{formatCount(post.num_comments)}</p>
    </article>
  );
}

function Mentions({ post }: { post: SocialPost }) {
  const links = [
    ...post.player_mentions.map((name) => ({ name, href: playerHref(name) })),
    ...post.team_mentions.map((name) => ({ name, href: teamHref(name) })),
  ];
  if (links.length === 0) return null;
  const shown = links.slice(0, 3);
  return (
    <>
      <Dot />
      {shown.map((link) => (
        <Link key={link.href} href={link.href} className="text-primary hover:underline">
          {link.name}
        </Link>
      ))}
      {links.length > shown.length ? <span>+{links.length - shown.length}</span> : null}
    </>
  );
}

function CapturedComments({ post }: { post: SocialPost }) {
  const [showAll, setShowAll] = useState(false);
  const commentsQuery = useQuery({
    queryKey: ["social-comments", post.reddit_id],
    queryFn: () => api.listSocialPostComments(post.reddit_id),
  });
  const rows = commentsQuery.data?.data ?? [];
  const shown = showAll ? rows : rows.slice(0, COMMENT_PREVIEW);

  return (
    <div className="mt-[var(--ct-space-4)] border-l-2 border-rule pl-[var(--ct-space-4)]">
      {commentsQuery.isLoading ? (
        <LoadingState label="Loading captured comments…" />
      ) : commentsQuery.isError ? (
        <ErrorState message={queryErrorMessage(commentsQuery.error)} />
      ) : rows.length === 0 ? (
        <p className="type-caption py-2">No comments were captured for this post.</p>
      ) : (
        <>
          <ul>
            {shown.map((comment) => (
              <CommentRow key={comment.reddit_id} comment={comment} />
            ))}
          </ul>
          {rows.length > shown.length ? (
            <button
              type="button"
              className="mt-1 text-[length:var(--ct-fs-cell)] text-primary hover:underline"
              onClick={() => setShowAll(true)}
            >
              Show all {rows.length} captured comments
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function CommentRow({ comment }: { comment: SocialComment }) {
  const flair = flairLabel(comment);
  return (
    <li
      className={cn(
        "flex gap-[var(--ct-space-3)] py-[var(--ct-space-3)]",
        !comment.is_top_level && "ml-[var(--ct-space-4)]"
      )}
    >
      <div className="min-w-0 flex-1">
        {comment.is_removed ? (
          <p className="type-caption italic">
            [removed]. This comment was deleted or removed before collection. Its score is kept
            because it counted toward concentration.
          </p>
        ) : (
          <p className="text-[length:var(--ct-fs-cell)] leading-relaxed">{comment.body}</p>
        )}
        <p className="type-caption mt-1 flex flex-wrap items-center gap-x-2">
          <span className={cn(comment.author ? "" : "italic text-ink-4")}>
            {comment.author ? `u/${comment.author}` : "author unavailable"}
          </span>
          {flair ? (
            <>
              <Dot />
              <span>{flair} fan</span>
            </>
          ) : null}
        </p>
      </div>
      <span className="tabular w-[48px] shrink-0 text-right text-[length:var(--ct-fs-num)] text-ink-3">
        {formatCount(comment.score)}
      </span>
    </li>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "loss" }) {
  return (
    <span
      className={cn(
        "type-eyebrow inline-flex items-center border px-1.5 py-0.5",
        tone === "loss" ? "border-destructive text-destructive" : "border-rule text-ink-3"
      )}
    >
      {children}
    </span>
  );
}

function Dot() {
  return <span aria-hidden>·</span>;
}
