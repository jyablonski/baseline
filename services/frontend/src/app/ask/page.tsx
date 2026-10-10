"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";

import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { ResultTable } from "@/components/result-table";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import type { NlpQueryResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "How many back-to-backs has Kawhi Leonard played?",
  "What is the Warriors' win percentage in Chicago?",
  "What is Curry's salary?",
  "What is the Warriors payroll?",
  "Who leads the West?",
  "How many leads have the Lakers blown?",
];

type AskTurn = {
  question: string;
  result?: NlpQueryResponse;
  error?: string;
};

export default function AskPage() {
  return (
    <Suspense>
      <AskPanel />
    </Suspense>
  );
}

function AskPanel() {
  const [question, setQuestion] = useState("");
  const [turn, setTurn] = useState<AskTurn | null>(null);
  const { season } = useSeason();

  const mutation = useMutation({
    mutationFn: (q: string) => api.queryNlp(q, season || undefined),
  });

  async function submit(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || mutation.isPending) return;

    setTurn({ question: trimmed });
    setQuestion("");

    try {
      const result = await mutation.mutateAsync(trimmed);
      setTurn({ question: trimmed, result });
    } catch (error) {
      setTurn({
        question: trimmed,
        error: queryErrorMessage(error),
      });
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(question);
  }

  const blocked = mutation.isPending;

  return (
    <div className="grid gap-8 lg:grid-cols-[1.4fr_0.7fr]">
      <section className="flex min-h-[32rem] flex-col">
        <header className="mb-6">
          <h1 className="type-page">Ask</h1>
          <p className="mt-1 text-sm text-ink-2">
            Rule-based answers over the same facts as the tables. Not a general NBA chatbot.
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-6">
          {!turn ? (
            <EmptyState
              title="Nothing asked yet"
              message="Pick a Try chip or type a question. Only the latest answer stays on this page."
            />
          ) : (
            <div className="space-y-6" role="article" aria-label="Latest question and answer">
              <div className="ml-auto max-w-[80%] bg-secondary px-3 py-2 text-sm">
                {turn.question}
              </div>
              {turn.error ? (
                <ErrorState message={turn.error} />
              ) : turn.result ? (
                <div className="space-y-3 text-sm">
                  <p className="whitespace-pre-wrap">{turn.result.answer}</p>
                  {turn.result.data && turn.result.data.length > 0 ? (
                    <ResultTable rows={turn.result.data} />
                  ) : null}
                  <AskDeepLink text={turn.result.answer} />
                </div>
              ) : (
                <LoadingState label="Asking…" />
              )}
            </div>
          )}
        </div>

        <form className="mt-6 flex gap-2" onSubmit={onSubmit}>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask a bounded question"
            disabled={blocked}
            className={cn("field field-ask flex-1", question.trim() && "field-query")}
          />
          <button
            type="submit"
            disabled={blocked || !question.trim()}
            className="btn-fill h-[var(--ct-control-ask)]"
          >
            Ask
          </button>
        </form>
        {turn?.error && blocked === false ? (
          <p className="mt-2 text-xs text-destructive">Couldn&apos;t load an answer.</p>
        ) : null}
      </section>

      <aside className="lg:border-l lg:border-rule lg:pl-[26px]">
        <h2 className="type-eyebrow">Try</h2>
        <div className="mt-3 space-y-2">
          {SUGGESTIONS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => void submit(item)}
              disabled={blocked}
              className="block w-full border border-rule bg-raised px-3 py-2 text-left text-sm hover:bg-tint disabled:opacity-50"
            >
              {item}
            </button>
          ))}
        </div>
        <p className="type-caption mt-6">
          Replies arrive whole (no streaming) and resolve to the same structured data seen elsewhere
          in the app.
        </p>
      </aside>
    </div>
  );
}

function AskDeepLink({ text }: { text: string }) {
  const lower = text.toLowerCase();
  if (lower.includes("warrior") || lower.includes("chicago") || lower.includes("clipper")) {
    return (
      <Link href="/teams" className="text-sm text-primary hover:underline">
        Open in Teams →
      </Link>
    );
  }
  if (lower.includes("lebron") || lower.includes("curry") || lower.includes("kawhi")) {
    return (
      <Link href="/players" className="text-sm text-primary hover:underline">
        Open in Players →
      </Link>
    );
  }
  return null;
}
