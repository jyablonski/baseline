import Link from "next/link";

import { ADMIN_TABS, adminTabHref, type AdminTab, type ReviewItem } from "@/lib/admin-status";
import { cn } from "@/lib/utils";

export const TAB_LABEL: Record<AdminTab, string> = {
  overview: "Overview",
  pipeline: "Pipeline",
  models: "Models",
  infrastructure: "Infrastructure",
  settings: "Settings",
};

/**
 * Section links for the admin page. Plain links on `?tab=` rather than client
 * tabs: the page is a server component, a tab stays bookmarkable, and it
 * survives the job buttons' router.refresh() polling.
 */
export function AdminTabs({ active, items }: { active: AdminTab; items: ReviewItem[] }) {
  return (
    <nav aria-label="Admin sections" className="flex flex-wrap border-b border-rule-strong">
      {ADMIN_TABS.map((tab) => {
        const flagged = items.filter((item) => item.tab === tab);
        const blocking = flagged.some((item) => item.level === "bad");
        return (
          <Link
            key={tab}
            href={adminTabHref(tab)}
            aria-current={tab === active ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-[3px] border-transparent px-4 py-2.5 text-ink-2 hover:text-foreground",
              tab === active && "border-primary font-semibold text-foreground"
            )}
          >
            {TAB_LABEL[tab]}
            {flagged.length > 0 ? (
              <span
                aria-label={`${flagged.length} to review`}
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded-full text-[11px] font-medium text-background",
                  blocking ? "bg-destructive" : "bg-warn"
                )}
              >
                {flagged.length}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
