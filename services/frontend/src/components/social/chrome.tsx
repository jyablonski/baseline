"use client";

import { KpiCard, KpiStrip, KpiTitle } from "@/components/ui/kpi-card";
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
  mostContested:
    { title: string; permalink: string; score: number; num_comments: number } | undefined;
}) {
  const captured = summary?.captured_comment_count ?? 0;
  const reported = summary?.reported_comment_count ?? 0;
  const capturedShare = reported > 0 ? captured / reported : 0;
  return (
    <KpiStrip>
      <KpiCard
        label="Posts collected"
        value={formatCount(summary?.post_count ?? 0)}
        note={`from ${formatCount(summary?.author_count ?? 0)} distinct posters`}
      />
      {/* The gap between these two numbers is the whole honesty of the page. */}
      <KpiCard
        label="Comments captured"
        value={formatCount(captured)}
        progress={capturedShare}
        note={`${Math.round(capturedShare * 100)}% of ${formatCount(reported)} posted`}
      />
      <KpiCard
        label="Most discussed"
        value={
          topPlayer ? (
            <KpiTitle>{topPlayer.entity_name}</KpiTitle>
          ) : (
            <KpiTitle className="text-ink-3">—</KpiTitle>
          )
        }
        note={
          topPlayer
            ? `${formatCount(topPlayer.post_count)} posts · ${formatCount(topPlayer.comment_count)} captured comments`
            : "no full-name matches in range"
        }
      />
      <KpiCard
        label="Most contested"
        value={
          mostContested ? (
            <KpiTitle className="line-clamp-3" title={mostContested.title}>
              {mostContested.title}
            </KpiTitle>
          ) : (
            <KpiTitle className="text-ink-3">—</KpiTitle>
          )
        }
        note={
          mostContested ? (
            <>
              {formatCount(mostContested.num_comments)} comments on a score of{" "}
              {formatCount(mostContested.score)}
              <a
                className="ct-ask-tool ml-3 text-[length:inherit]"
                href={mostContested.permalink}
                target="_blank"
                rel="noreferrer"
              >
                Open ↗
              </a>
            </>
          ) : (
            `${summary?.contested_post_count ?? 0} contested posts in range`
          )
        }
      />
    </KpiStrip>
  );
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
  // Padded on the left only: the labels sit over the feed's text, and the sort
  // control ends flush with the rail panels below it.
  return (
    <div className="flex flex-wrap items-center gap-x-[var(--ct-space-4)] gap-y-3 border-b border-rule py-[var(--ct-space-3)] pl-[var(--ct-space-2)]">
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
