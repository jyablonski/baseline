"use client";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { lastNight, lastNightResult } from "@/lib/back-to-back";
import type { ScheduledGame } from "@/lib/types";
import { cn } from "@/lib/utils";

const B2B_BADGE =
  "h-[18px] border-ink-4 px-1 text-[length:var(--ct-fs-meta)] leading-none font-semibold text-ink-2";

/**
 * "B2B" beside a team that played the night before. A button of its own, set
 * next to the team link and never inside it, so a tap opens the detail instead
 * of navigating. Opens on hover for a mouse, like InfoTip.
 */
export function B2BBadge({
  game,
  side,
  className,
}: {
  game: ScheduledGame;
  side: "home" | "away";
  className?: string;
}) {
  const night = lastNight(game, side);
  if (!night) return null;
  const result = lastNightResult(night);
  const title = `${night.abbreviation} played last night`;
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        aria-label={result ? `${title}: ${result}` : title}
        // A 24px hit area around an 18px badge: big enough to tap without
        // spilling onto the team link and "@" beside it.
        className={cn(
          "group/b2b inline-flex h-6 shrink-0 items-center outline-none focus-visible:ring-2 focus-visible:ring-primary",
          className
        )}
      >
        <Badge
          variant="outline"
          className={cn(
            B2B_BADGE,
            "group-hover/b2b:border-foreground group-hover/b2b:text-foreground group-data-[popup-open]/b2b:border-foreground group-data-[popup-open]/b2b:text-foreground"
          )}
        >
          B2B
        </Badge>
      </PopoverTrigger>
      <PopoverContent title={title} className="w-[min(280px,calc(100vw-24px))]">
        <p className="text-ink-2">{result ? `${result} · ` : null}second night of a back-to-back</p>
      </PopoverContent>
    </Popover>
  );
}

/** The legend for a view with badges: one per view, not per row. */
export function B2BLegend({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 type-caption", className)}>
      <Badge variant="outline" aria-hidden="true" className={B2B_BADGE}>
        B2B
      </Badge>
      Played last night
    </span>
  );
}
