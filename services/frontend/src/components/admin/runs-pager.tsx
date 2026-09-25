import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Newer/Older links for the recent-runs table. Plain links rather than client
 * state: the page is a server component, and `?runs=N` keeps a page
 * bookmarkable and survives the job buttons' router.refresh() polling.
 */
export function RunsPager({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const href = (target: number) => (target <= 1 ? "/admin" : `/admin?runs=${target}`);

  return (
    <nav aria-label="Recent runs pages" className="flex items-center justify-between gap-4">
      <p className="text-xs text-muted-foreground tabular-nums">
        {first}–{last} of {total}
      </p>
      <div className="flex gap-2">
        <PagerLink href={href(page - 1)} disabled={page <= 1}>
          Newer
        </PagerLink>
        <PagerLink href={href(page + 1)} disabled={page >= pages}>
          Older
        </PagerLink>
      </div>
    </nav>
  );
}

function PagerLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className = buttonVariants({ variant: "outline", size: "sm" });
  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(className, "pointer-events-none opacity-50")}>
        {children}
      </span>
    );
  }
  // scroll={false}: the table is at the bottom of a long page.
  return (
    <Link href={href} scroll={false} className={className}>
      {children}
    </Link>
  );
}
