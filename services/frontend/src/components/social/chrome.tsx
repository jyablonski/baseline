"use client";

import {
  SOCIAL_RANGES,
  SOCIAL_SORTS,
  CONTENT_TYPE_LABELS,
  facetCount,
  formatCount,
  totalFacetCount,
  type SocialRangeKey,
} from "@/lib/social";
import type { SocialEntity, SocialFacet, SocialSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SummaryStrip({
  summary,
  topPlayer,
  mostContested,
}: {
  summary: SocialSummary | undefined;
  topPlayer: SocialEntity | undefined;
  mostContested: { title: string; score: number; num_comments: number } | undefined;
}) {
  return (
    <div className="grid border-y border-rule-strong sm:grid-cols-2 lg:grid-cols-4">
      <Cell label="Posts collected">
        <span className="type-stat tabular">{formatCount(summary?.post_count ?? 0)}</span>
        <Note>{formatCount(summary?.author_count ?? 0)} distinct posters</Note>
      </Cell>
      <Cell label="Comments captured">
        <span className="type-stat tabular">
          {formatCount(summary?.captured_comment_count ?? 0)}
        </span>
        {/* The gap between these two numbers is the whole honesty of the page. */}
        <Note>top 10 per post, of {formatCount(summary?.reported_comment_count ?? 0)} posted</Note>
      </Cell>
      <Cell label="Most discussed">
        {topPlayer ? (
          <>
            <span className="type-module block leading-tight">{topPlayer.entity_name}</span>
            <Note>
              named in {topPlayer.post_count} posts, {topPlayer.comment_count} captured comments
            </Note>
          </>
        ) : (
          <>
            <span className="type-module block text-ink-3">—</span>
            <Note>no full-name matches in range</Note>
          </>
        )}
      </Cell>
      <Cell label="Most contested">
        {mostContested ? (
          <>
            <span className="type-module block leading-tight">“{mostContested.title}”</span>
            <Note>
              {formatCount(mostContested.num_comments)} comments on a score of {mostContested.score}
            </Note>
          </>
        ) : (
          <>
            <span className="type-module block text-ink-3">—</span>
            <Note>{summary?.contested_post_count ?? 0} contested posts in range</Note>
          </>
        )}
      </Cell>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-rule px-[var(--ct-space-4)] py-[var(--ct-space-3)] sm:border-r last:sm:border-r-0">
      <p className="type-eyebrow">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="type-caption mt-1">{children}</p>;
}

export function SocialControls({
  range,
  onRange,
  contentType,
  onContentType,
  sort,
  onSort,
  facets,
}: {
  range: SocialRangeKey;
  onRange: (next: SocialRangeKey) => void;
  contentType: string;
  onContentType: (next: string) => void;
  sort: string;
  onSort: (next: string) => void;
  facets: SocialFacet[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-[var(--ct-space-4)] gap-y-3 border-b border-rule px-[var(--ct-space-2)] py-[var(--ct-space-3)]">
      <div className="flex items-center gap-2">
        <span className="type-eyebrow">Range</span>
        {SOCIAL_RANGES.map((item) => (
          <Chip key={item.key} active={range === item.key} onClick={() => onRange(item.key)}>
            {item.label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="type-eyebrow">Type</span>
        <Chip active={contentType === ""} onClick={() => onContentType("")}>
          All <Tally>{totalFacetCount(facets)}</Tally>
        </Chip>
        {Object.entries(CONTENT_TYPE_LABELS).map(([key, label]) => (
          <Chip key={key} active={contentType === key} onClick={() => onContentType(key)}>
            {label} <Tally>{facetCount(facets, key)}</Tally>
          </Chip>
        ))}
      </div>

      <label className="ml-auto flex items-center gap-2">
        <span className="type-eyebrow">Sort</span>
        <select
          className="h-[var(--ct-control-page)] border border-input bg-field px-2 text-[var(--ct-fs-cell)]"
          value={sort}
          onChange={(event) => onSort(event.target.value)}
        >
          {SOCIAL_SORTS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-[var(--ct-control-page)] items-center gap-1.5 border px-[var(--ct-space-3)] text-[var(--ct-fs-cell)]",
        // Theme tokens only (primary is the brand green, like .seg-btn-active):
        // a class the theme does not define, such as bg-ink, resolves to nothing
        // and leaves the paper-coloured label invisible on the active chip.
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-rule bg-raised hover:bg-tint"
      )}
    >
      {children}
    </button>
  );
}

function Tally({ children }: { children: React.ReactNode }) {
  return <span className="tabular text-[var(--ct-fs-meta)] opacity-70">{children}</span>;
}
