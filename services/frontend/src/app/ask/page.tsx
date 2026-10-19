"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";

import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { ResultTable } from "@/components/result-table";
import { useSeason } from "@/hooks/use-season";
import { api, queryErrorMessage } from "@/lib/api";
import { ASK_SUGGESTIONS, entityHref, entityKindLabel } from "@/lib/ask";
import type { NlpEntity, NlpQueryResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

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

    // The question stays in the box so the chips below can be read against it.
    setQuestion(trimmed);
    setTurn({ question: trimmed });

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
      <section>
        <header className="mb-6">
          <h1 className="type-page">Ask</h1>
          <p className="mt-1 text-sm text-ink-2">
            Quick questions about teams, players and standings. Not an AI chatbot: it matches names
            and keywords, so short questions work best.
          </p>
        </header>

        {/* Firefox restores a form's controls on reload before React hydrates, so the
            Ask button came back enabled while the server rendered it disabled. */}
        <form className="flex" onSubmit={onSubmit} autoComplete="off">
          <div className="relative flex-1">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about a team, player or the standings"
              aria-label="Question"
              disabled={blocked}
              className={cn("field field-ask w-full pr-8", question.trim() && "field-query")}
            />
            {question && !blocked ? (
              <button
                type="button"
                onClick={() => setQuestion("")}
                aria-label="Clear question"
                className="absolute top-1/2 right-2 -translate-y-1/2 px-1 text-ink-3 hover:text-ink"
              >
                ×
              </button>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={blocked || !question.trim()}
            className="btn-fill h-[var(--ct-control-ask)]"
          >
            Ask
          </button>
        </form>

        <div className="mt-6">
          {!turn ? (
            <EmptyState
              title="Nothing asked yet"
              message="Pick a question to try or type your own. Only the latest answer stays on this page."
            />
          ) : (
            <div className="space-y-5" role="article" aria-label="Latest question and answer">
              {turn.error ? (
                <ErrorState message={turn.error} />
              ) : turn.result ? (
                <AskAnswer result={turn.result} onAsk={submit} blocked={blocked} />
              ) : (
                <LoadingState label="Asking…" />
              )}
            </div>
          )}
        </div>
      </section>

      <aside className="lg:border-l lg:border-rule lg:pl-[26px]">
        <h2 className="type-eyebrow">Try</h2>
        <div className="mt-3 space-y-5">
          {ASK_SUGGESTIONS.map(({ group, questions }) => (
            <section key={group} aria-label={group}>
              <h3 className="mb-2 text-xs font-semibold text-ink-2">{group}</h3>
              <div className="space-y-2">
                {questions.map((item) => (
                  <QuestionButton
                    key={item}
                    question={item}
                    onAsk={submit}
                    disabled={blocked}
                    className="block w-full py-2"
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
        <p className="type-caption mt-6">Teams can be named by nickname, city or abbreviation.</p>
      </aside>
    </div>
  );
}

function AskAnswer({
  result,
  onAsk,
  blocked,
}: {
  result: NlpQueryResponse;
  onAsk: (question: string) => void;
  blocked: boolean;
}) {
  const entities = result.entities ?? [];
  const followUps = result.follow_ups ?? [];
  const linked = entities.filter((entity) => entityHref(entity) != null);
  const { clarify } = result;

  if (clarify) {
    return (
      <div className="space-y-3 border border-rule bg-raised p-5">
        <p className="font-semibold">{clarify.prompt}</p>
        <p className="text-sm text-ink-2">{result.answer}</p>
        <button
          type="button"
          className="btn-fill"
          disabled={blocked}
          onClick={() => onAsk(clarify.question)}
        >
          {clarify.action}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {entities.length > 0 ? <ReadingAs entities={entities} /> : null}
      {/* The answer and what backs it, ruled off from the chips above. */}
      <div className={cn("space-y-5", entities.length > 0 && "border-t border-rule pt-5")}>
        <AnswerSentence answer={result.answer} value={result.value} />
        {result.show_data !== false && result.data && result.data.length > 0 ? (
          <ResultTable rows={result.data} highlightRow={result.highlight_row} />
        ) : null}
        {linked.length > 0 ? (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {linked.map((entity) => (
              <Link
                key={`${entity.kind}-${entity.label}`}
                href={entityHref(entity)!}
                className="text-primary hover:underline"
              >
                {entity.label} page →
              </Link>
            ))}
          </div>
        ) : null}
      </div>
      {followUps.length > 0 ? (
        <section aria-label="Ask next" className="border-t border-rule pt-5">
          <h2 className="mb-2 text-xs font-semibold text-ink-2">Ask next</h2>
          <div className="flex flex-wrap gap-2">
            {followUps.map((item) => (
              <QuestionButton
                key={item}
                question={item}
                onAsk={onAsk}
                disabled={blocked}
                className="py-1.5"
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** The sentence at regular weight with only the key figure bold, so the eye lands on it. */
function AnswerSentence({ answer, value }: { answer: string; value?: string | null }) {
  const at = value ? answer.indexOf(value) : -1;
  return (
    <p className="text-xl leading-snug whitespace-pre-wrap">
      {value && at >= 0 ? (
        <>
          {answer.slice(0, at)}
          <strong className="font-semibold">{value}</strong>
          {answer.slice(at + value.length)}
        </>
      ) : (
        answer
      )}
    </p>
  );
}

function QuestionButton({
  question,
  onAsk,
  disabled,
  className,
}: {
  question: string;
  onAsk: (question: string) => void;
  disabled: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onAsk(question)}
      disabled={disabled}
      className={cn(
        "border border-rule bg-raised px-3 text-left text-sm hover:bg-tint disabled:opacity-50",
        className
      )}
    >
      {question}
    </button>
  );
}

/** What the engine matched, so a wrong guess is visible before the answer is trusted. */
function ReadingAs({ entities }: { entities: NlpEntity[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-3">Reading this as</span>
      {entities.map((entity) => (
        <span
          key={`${entity.kind}-${entity.label}`}
          className={cn(
            "inline-flex items-baseline gap-1.5 border border-rule px-2 py-0.5",
            entityHref(entity) ? "bg-tint" : "bg-raised"
          )}
        >
          <span className="text-xs text-ink-3">{entityKindLabel(entity.kind)}</span>
          <span className="font-medium">{entity.label}</span>
        </span>
      ))}
    </div>
  );
}
