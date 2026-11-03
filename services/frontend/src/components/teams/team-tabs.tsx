import Link from "next/link";

import { TEAM_TAB_LABEL, TEAM_TABS, teamTabHref, type TeamTab } from "@/lib/team-page";
import { cn } from "@/lib/utils";

/**
 * Section links for a team page, on `?tab=` like the admin page: a tab is
 * bookmarkable and the back button walks through them.
 */
export function TeamTabs({
  active,
  pathname,
  params,
  outCount,
}: {
  active: TeamTab;
  pathname: string;
  params: URLSearchParams;
  /** Players ruled out, shown as a badge on Roster. */
  outCount: number;
}) {
  return (
    <nav aria-label="Team sections" className="flex flex-wrap border-b border-rule-strong">
      {TEAM_TABS.map((tab) => (
        <Link
          key={tab}
          href={teamTabHref(pathname, params, tab)}
          scroll={false}
          aria-current={tab === active ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-2 border-b-[3px] border-transparent px-4 py-2.5 text-ink-2 hover:text-foreground",
            tab === active && "border-primary font-semibold text-foreground"
          )}
        >
          {TEAM_TAB_LABEL[tab]}
          {tab === "roster" && outCount > 0 ? (
            <span
              aria-label={`${outCount} out`}
              className="inline-flex size-5 items-center justify-center rounded-full bg-destructive text-[11px] font-medium text-background"
            >
              {outCount}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
