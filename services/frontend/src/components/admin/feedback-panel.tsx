import Link from "next/link";

import { FeedbackResolve } from "@/components/admin/feedback-resolve";
import { Section } from "@/components/admin/section";
import type { FeedbackPage } from "@/lib/admin";
import { formatAge } from "@/lib/admin-status";
import { FEEDBACK_KINDS } from "@/lib/feedback";
import { cn } from "@/lib/utils";

const KIND_LABEL = Object.fromEntries(FEEDBACK_KINDS.map((kind) => [kind.value, kind.label]));

/**
 * Reports sent from /feedback. Every field is visitor-written: rendered as
 * text only, and the page link is a same-site path the API has already checked.
 */
export function FeedbackPanel({
  page,
  includeResolved,
}: {
  page: FeedbackPage | null;
  includeResolved: boolean;
}) {
  const toggle = includeResolved ? "/admin?tab=feedback" : "/admin?tab=feedback&all=1";
  const shown = page?.data.length ?? 0;
  const total = page?.meta.total ?? 0;

  return (
    <div className="pt-10">
      <Section
        title={includeResolved ? "All reports" : "Open reports"}
        note={
          page && total > shown
            ? `${includeResolved ? "First" : "Newest"} ${shown} of ${total}`
            : undefined
        }
      >
        <p className="text-sm">
          <Link className="underline underline-offset-2" href={toggle}>
            {includeResolved ? "Show open only" : "Include resolved"}
          </Link>
        </p>
        {page === null ? (
          <p className="text-sm text-muted-foreground">Could not load the reports.</p>
        ) : page.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {includeResolved ? "No reports yet." : "Nothing open."}
          </p>
        ) : (
          <ul className="divide-y divide-rule border-b border-rule">
            {page.data.map((report) => (
              <li
                key={report.feedback_id}
                className={cn(
                  "flex flex-wrap items-start justify-between gap-4 py-4",
                  report.resolved_at && "text-ink-2"
                )}
                data-testid={`feedback-${report.feedback_id}`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="type-caption">
                    {KIND_LABEL[report.kind] ?? report.kind} · {formatAge(report.created_at)} ·{" "}
                    {report.signed_in ? "signed in" : "anonymous"}
                    {report.page_path ? (
                      <>
                        {" · "}
                        <Link className="underline underline-offset-2" href={report.page_path}>
                          {report.page_path}
                        </Link>
                      </>
                    ) : null}
                    {report.resolved_at ? ` · resolved ${formatAge(report.resolved_at)}` : null}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{report.message}</p>
                  {report.reply_email ? (
                    <p className="text-sm">
                      Reply to{" "}
                      <a
                        className="underline underline-offset-2"
                        href={`mailto:${report.reply_email}`}
                      >
                        {report.reply_email}
                      </a>
                    </p>
                  ) : null}
                </div>
                <FeedbackResolve
                  feedbackId={report.feedback_id}
                  resolved={report.resolved_at !== null}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
