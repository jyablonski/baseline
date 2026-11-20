import type { Metadata } from "next";
import Link from "next/link";

import { FeedbackForm } from "@/components/feedback/feedback-form";
import { CONTACT_EMAIL } from "@/lib/contact";
import { parseFeedbackKind, parseFeedbackPage } from "@/lib/feedback";

export const metadata: Metadata = {
  title: "Feedback",
  description: "Report a wrong number or a bug on Baseline, or suggest something.",
};

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[]; from?: string | string[] }>;
}) {
  const params = await searchParams;
  const kind = parseFeedbackKind(params.kind);
  const pagePath = parseFeedbackPage(params.from);

  return (
    <article className="space-y-8">
      <header>
        <h1 className="type-page">Feedback</h1>
        <p className="type-prose mt-1">Spotted a wrong number, hit a bug, or have an idea?</p>
        {pagePath ? (
          <p className="type-caption mt-1">
            About{" "}
            <Link className="underline underline-offset-2" href={pagePath}>
              {pagePath}
            </Link>
          </p>
        ) : null}
      </header>

      <FeedbackForm kind={kind} pagePath={pagePath} />

      <p className="text-sm text-ink-2">
        Prefer email?{" "}
        <a className="underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        . What a report keeps is on the{" "}
        <Link className="underline underline-offset-2" href="/privacy">
          privacy page
        </Link>
        .
      </p>
    </article>
  );
}
