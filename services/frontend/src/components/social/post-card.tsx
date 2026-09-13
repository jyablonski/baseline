"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ErrorState, LoadingState } from "@/components/query-state";
import { api, queryErrorMessage } from "@/lib/api";
import {
  CONTENT_TYPE_LABELS,
  flairLabel,
  formatCount,
  postSourceLabel,
  relativeAge,
} from "@/lib/social";
import type { SocialComment, SocialPost } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PostCard({
  post,
  defaultOpen = false,
}: {
  post: SocialPost;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <article className="border-b border-rule last:border-b-0">
      <div className="flex gap-[var(--ct-space-4)] px-[var(--ct-space-2)] py-[var(--ct-space-4)]">
        <div className="w-[68px] shrink-0 text-right">
          <p className="type-stat tabular leading-none">{formatCount(post.score)}</p>
          <p className="type-eyebrow mt-1">Score</p>
          <p className="type-stat tabular mt-3 leading-none">{formatCount(post.num_comments)}</p>
          <p className="type-eyebrow mt-1">Comments</p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {post.is_contested ? <Tag tone="loss">Contested</Tag> : null}
            <Tag>{CONTENT_TYPE_LABELS[post.content_type] ?? post.content_type}</Tag>
            <Tag>{postSourceLabel(post)}</Tag>
            {post.tag ? <Tag>{post.tag}</Tag> : null}
            {post.flair ? <span className="type-caption">{post.flair}</span> : null}
          </div>

          <h3 className="type-module leading-snug">{post.title}</h3>

          <p className="type-caption mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>u/{post.author ?? "author unavailable"}</span>
            <Dot />
            <AuthorFlair post={post} />
            <Dot />
            <span>{relativeAge(post.created_utc)}</span>
            <Dot />
            <a className="ct-ask-tool" href={post.permalink} target="_blank" rel="noreferrer">
              reddit thread
            </a>
          </p>

          <Mentions post={post} />

          <button
            type="button"
            className="ct-ask-tool mt-3"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            {open
              ? "Hide comments"
              : `Show top ${post.captured_comment_count} of ${formatCount(post.num_comments)}`}
          </button>
        </div>
      </div>

      {open ? <CapturedComments post={post} /> : null}
    </article>
  );
}

function Mentions({ post }: { post: SocialPost }) {
  const names = [...post.player_mentions, ...post.team_mentions];
  if (names.length === 0) return null;
  const shown = names.slice(0, 3);
  return (
    <p className="type-caption mt-2">
      <span className="type-eyebrow mr-2">Mentions</span>
      {shown.join(", ")}
      {names.length > shown.length ? ` +${names.length - shown.length} more` : ""}
    </p>
  );
}

function AuthorFlair({ post }: { post: SocialPost }) {
  const label = flairLabel(post);
  if (!label) return <span className="text-ink-4">no flair</span>;
  return <span>{label} fan</span>;
}

function CapturedComments({ post }: { post: SocialPost }) {
  const commentsQuery = useQuery({
    queryKey: ["social-comments", post.reddit_id],
    queryFn: () => api.listSocialPostComments(post.reddit_id),
  });
  const rows = commentsQuery.data?.data ?? [];

  return (
    <div className="border-t border-rule bg-raised">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-[var(--ct-space-2)] py-2">
        <span className="type-eyebrow">
          Top {post.captured_comment_count} of {formatCount(post.num_comments)} comments
        </span>
        <span className="type-caption">
          highest-scoring only · the rest of the thread is not stored
        </span>
        <a className="ct-ask-tool ml-auto" href={post.permalink} target="_blank" rel="noreferrer">
          Read all {formatCount(post.num_comments)} on reddit
        </a>
      </div>

      {commentsQuery.isLoading ? (
        <div className="px-[var(--ct-space-2)]">
          <LoadingState label="Loading captured comments…" />
        </div>
      ) : commentsQuery.isError ? (
        <ErrorState message={queryErrorMessage(commentsQuery.error)} />
      ) : rows.length === 0 ? (
        <p className="type-caption px-[var(--ct-space-2)] py-4">
          No comments were captured for this post.
        </p>
      ) : (
        <ul>
          {rows.map((comment) => (
            <CommentRow key={comment.reddit_id} comment={comment} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentRow({ comment }: { comment: SocialComment }) {
  const flair = flairLabel(comment);
  return (
    <li
      className={cn(
        "flex gap-[var(--ct-space-3)] border-b border-rule-soft px-[var(--ct-space-2)] py-[var(--ct-space-3)] last:border-b-0",
        !comment.is_top_level &&
          "ml-[var(--ct-space-5)] border-l border-rule pl-[var(--ct-space-3)]",
        comment.is_removed && "bg-tint"
      )}
    >
      <span className="tabular w-[54px] shrink-0 text-right text-[var(--ct-fs-num)]">
        {formatCount(comment.score)}
      </span>
      <div className="min-w-0">
        <p className="type-caption flex flex-wrap items-center gap-2">
          <span className={cn(comment.author ? "" : "italic text-ink-4")}>
            {comment.author ? `u/${comment.author}` : "author unavailable"}
          </span>
          <Tag>{comment.is_top_level ? "Top level" : "Reply"}</Tag>
          {flair ? <span className="text-ink-3">{flair} fan</span> : null}
        </p>
        {comment.is_removed ? (
          <p className="type-caption mt-1 italic">
            [removed]. This comment was deleted or removed before collection. Its score is kept
            because it counted toward concentration.
          </p>
        ) : (
          <p className="mt-1 text-[var(--ct-fs-cell)] leading-relaxed">{comment.body}</p>
        )}
      </div>
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
