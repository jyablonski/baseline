"use client";

import Link from "next/link";

import { KpiCard, KpiStrip, KpiTitle } from "@/components/ui/kpi-card";
import { playerHref, teamHref } from "@/lib/nav";
import {
  SOCIAL_RANGES,
  SOCIAL_SORTS,
  CONTENT_TYPE_LABELS,
  facetCount,
  formatCount,
  relativeAge,
  totalFacetCount,
  type RisingEntity,
  type SocialRangeKey,
} from "@/lib/social";
import type { SocialEntity, SocialFacet, SocialSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

type Contested = { title: string; permalink: string; score: number; num_comments: number };

/**
 * What r/nba is on about in the range, in basketball terms. How much was
 * collected is in `AboutSocialData` at the foot of the page, not up here.
 */
export function SummaryStrip({
  range,
  topTeam,
  topPlayer,
  rising,
  compared,
  mostContested,
  contestedCount,
}: {
  range: SocialRangeKey;
  topTeam: SocialEntity | undefined;
  topPlayer: SocialEntity | undefined;
  rising: RisingEntity | null;
  /** Whether the window before had any mentions to measure a rise against. */
  compared: boolean;
  mostContested: Contested | undefined;
  contestedCount: number;
}) {
  const rangeLabel = SOCIAL_RANGES.find((item) => item.key === range)?.label ?? range;
  return (
    <KpiStrip>
      <KpiCard
        label="Most discussed team"
        value={
          <EntityTitle
            name={topTeam ? (topTeam.entity_nickname ?? topTeam.entity_name) : null}
            href={topTeam ? teamHref(topTeam.entity_name) : null}
          />
        }
        note={topTeam ? mentionNote(topTeam) : "no team mentions in range"}
      />
      <KpiCard
        label="Most discussed player"
        value={
          <EntityTitle
            name={topPlayer?.entity_name ?? null}
            href={topPlayer ? playerHref(topPlayer.entity_name) : null}
          />
        }
        note={topPlayer ? mentionNote(topPlayer) : "no full-name matches in range"}
      />
      <KpiCard
        label="Rising"
        value={
          <EntityTitle
            name={rising ? (rising.entity.entity_nickname ?? rising.entity.entity_name) : null}
            href={
              rising
                ? (rising.kind === "team" ? teamHref : playerHref)(rising.entity.entity_name)
                : null
            }
          />
        }
        note={
          rising
            ? `+${formatCount(rising.gain)} posts vs the ${rangeLabel} before (${formatCount(rising.previous)} → ${formatCount(rising.entity.post_count)})`
            : compared
              ? `no player or team gained on the ${rangeLabel} before`
              : `nothing collected the ${rangeLabel} before to compare with`
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
            `${formatCount(contestedCount)} contested posts in range`
          )
        }
      />
    </KpiStrip>
  );
}

function EntityTitle({ name, href }: { name: string | null; href: string | null }) {
  if (!name || !href) return <KpiTitle className="text-ink-3">—</KpiTitle>;
  return (
    <KpiTitle>
      <Link href={href} className="hover:text-primary hover:underline">
        {name}
      </Link>
    </KpiTitle>
  );
}

function mentionNote(entity: SocialEntity) {
  return `${formatCount(entity.post_count)} ${entity.post_count === 1 ? "post" : "posts"} · ${formatCount(entity.comment_count)} captured comments`;
}

/**
 * How much of r/nba the page is built from. The capture share matters: comments
 * are each thread's top ones, so a reader should know how much of a thread that is.
 */
export function AboutSocialData({ summary }: { summary: SocialSummary | undefined }) {
  if (!summary) return null;
  const captured = summary.captured_comment_count;
  const reported = summary.reported_comment_count;
  const share = reported > 0 ? Math.round((captured / reported) * 100) : 0;
  return (
    <section
      aria-label="About this data"
      className="type-caption border-t border-rule pt-[var(--ct-space-3)]"
      data-testid="social-about"
    >
      <span className="font-semibold text-ink-2">About this data</span>
      {" · "}
      {formatCount(summary.post_count)} posts from {formatCount(summary.author_count)} posters in
      this range · {formatCount(captured)} of {formatCount(reported)} comments captured ({share}
      %), each thread&apos;s highest-scoring · collected once a day
      {summary.last_scraped_at ? `, last ${relativeAge(summary.last_scraped_at)}` : ""}
    </section>
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
