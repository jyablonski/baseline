"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { chatAction, getProfileAction } from "@/app/account/actions";
import { SignInPrompt } from "@/components/account/sign-in-prompt";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { ResultTable } from "@/components/result-table";
import { useSeason } from "@/hooks/use-season";
import { useAccount, useFeatures } from "@/lib/account";
import { askDisplayRows, askTableColumns } from "@/lib/ask-table";
import { CHAT_STARTERS, followUps, sourceLabel } from "@/lib/chat";
import type { ChatQuota, ChatReply, ChatTurn } from "@/lib/types";
import { cn } from "@/lib/utils";

// Matches the API's cap; the field stops the visitor before the server does.
const MAX_QUESTION_CHARS = 500;
// Rows shown before "View full table". The sentence above usually covers these.
const TABLE_PREVIEW = 5;

type Exchange = { question: string; reply?: ChatReply; error?: string };

export default function ChatPage() {
  return (
    <Suspense>
      <ChatBody />
    </Suspense>
  );
}

function ChatBody() {
  const { account, isLoading: accountIsLoading } = useAccount();
  const features = useFeatures();

  if (accountIsLoading || features.isLoading) {
    return (
      <Shell>
        <LoadingState label="Loading chat…" />
      </Shell>
    );
  }
  if (!features.chatbot) {
    return (
      <Shell>
        <div className="space-y-2 text-center">
          <EmptyState title="Chat is not available" message="Chat is turned off for now." />
          <Link href="/ask" className="text-sm text-primary hover:underline">
            Ask a single question instead →
          </Link>
        </div>
      </Shell>
    );
  }
  if (!account) {
    return (
      <Shell>
        <SignInPrompt returnTo="/chat">Sign in to ask questions about the data.</SignInPrompt>
      </Shell>
    );
  }
  if (!account.hasAccount) {
    return (
      <Shell>
        <ErrorState message="Accounts are not available right now." />
      </Shell>
    );
  }
  return <Conversation />;
}

const INTRO =
  "Every answer shows the rows it came from. Questions may be sent to a third-party model provider.";

function Shell({ quota, children }: { quota?: ChatQuota; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[920px] flex-col">
      <header className="flex flex-wrap items-end justify-between gap-x-[var(--ct-space-5)] gap-y-3 border-b border-rule pb-[var(--ct-space-4)]">
        <div className="min-w-0 flex-1 basis-[28rem]">
          <h1 className="type-page">Chat</h1>
          <p className="type-prose mt-1 text-ink-2">{INTRO}</p>
        </div>
        {quota ? <QuotaMeter quota={quota} /> : null}
      </header>
      {children}
    </div>
  );
}

function QuotaMeter({ quota }: { quota: ChatQuota }) {
  const resets = new Date(quota.resets_at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const share = quota.daily_limit > 0 ? quota.remaining / quota.daily_limit : 0;
  return (
    <div className="w-[180px] shrink-0" data-testid="chat-quota">
      <p className="type-caption text-right">
        <span className="tabular">{quota.remaining}</span> of{" "}
        <span className="tabular">{quota.daily_limit}</span> left · resets {resets}
      </p>
      <div
        className="mt-2 h-[3px] bg-rule"
        role="progressbar"
        aria-label="Questions left today"
        aria-valuemin={0}
        aria-valuemax={quota.daily_limit}
        aria-valuenow={quota.remaining}
      >
        <div className="h-full bg-primary" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

function Conversation() {
  const { season } = useSeason();
  const queryClient = useQueryClient();
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["chat-quota"],
    queryFn: async () => {
      const result = await getProfileAction();
      if (!result.ok) throw new Error(result.message);
      return result.data.chat;
    },
    retry: false,
  });
  const quota = profileQuery.data;

  // Only answered exchanges count as turns: a failed one is not resent, so it
  // takes no room in the conversation.
  const answered = exchanges.filter((exchange) => exchange.reply);
  const outOfQuestions = quota?.remaining === 0;
  const conversationFull = quota != null && answered.length >= quota.max_turns;
  const closed = pending || outOfQuestions || conversationFull;
  const lastReply = exchanges.at(-1)?.reply;
  const suggestions = exchanges.length === 0 ? CHAT_STARTERS : followUps(lastReply?.source);

  async function ask(text: string) {
    const asked = text.trim();
    if (!asked || closed) return;

    const history: ChatTurn[] = answered.flatMap((exchange) => [
      { role: "user" as const, content: exchange.question },
      { role: "assistant" as const, content: (exchange.reply as ChatReply).answer },
    ]);
    setExchanges((current) => [...current, { question: asked }]);
    setQuestion("");
    setPending(true);

    const result = await chatAction(
      [...history, { role: "user", content: asked }],
      season || undefined
    );
    setExchanges((current) => [
      ...current.slice(0, -1),
      result.ok
        ? { question: asked, reply: result.data }
        : { question: asked, error: result.message },
    ]);
    if (result.ok) {
      queryClient.setQueryData<ChatQuota>(["chat-quota"], result.data.quota);
    } else {
      // A refusal may be the quota itself; re-read it rather than guess.
      void profileQuery.refetch();
    }
    setPending(false);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <Shell quota={quota}>
      <div className="min-h-[18rem] py-[var(--ct-space-5)]">
        {exchanges.length === 0 ? (
          <EmptyState
            title="Nothing asked yet"
            message="Ask a question, then follow up. Each answer comes with the rows behind it."
          />
        ) : (
          <ol className="space-y-[var(--ct-space-5)]">
            {exchanges.map((exchange, index) => (
              <li key={index} className="space-y-[var(--ct-space-4)]" data-testid="chat-exchange">
                <p className="ml-auto w-fit max-w-[80%] bg-foreground px-4 py-2.5 text-background">
                  {exchange.question}
                </p>
                {exchange.error ? (
                  <p className="text-sm text-destructive" role="alert">
                    {exchange.error}
                  </p>
                ) : exchange.reply ? (
                  <Answer reply={exchange.reply} />
                ) : (
                  <LoadingState label="Asking…" />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {suggestions.length > 0 && !closed ? (
        <div className="mb-3 flex flex-wrap gap-2" aria-label="Suggested questions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => void ask(suggestion)}
              className="border border-rule bg-raised px-3 py-1.5 text-[var(--ct-fs-cell)] hover:bg-tint"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      <form className="flex" onSubmit={onSubmit}>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={MAX_QUESTION_CHARS}
          placeholder={
            outOfQuestions
              ? "No questions left today"
              : conversationFull
                ? "This conversation is full"
                : exchanges.length > 0
                  ? "Ask a follow-up"
                  : "Ask about the data"
          }
          aria-label="Your question"
          disabled={closed}
          className={cn("field field-ask flex-1", question.trim() && "field-query")}
        />
        <button
          type="submit"
          disabled={closed || !question.trim()}
          className="btn-fill h-[var(--ct-control-ask)] px-6"
        >
          Ask
        </button>
      </form>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="type-caption" data-testid="chat-turns">
          {conversationFull
            ? "This conversation is full. Start a new one to keep going."
            : quota && exchanges.length > 0
              ? `Question ${Math.min(answered.length + 1, quota.max_turns)} of ${quota.max_turns} · kept in this tab only`
              : "The conversation is kept in this tab only."}
        </p>
        {exchanges.length > 0 ? (
          <button
            type="button"
            className="text-xs text-primary underline underline-offset-2 disabled:opacity-50"
            disabled={pending}
            onClick={() => setExchanges([])}
          >
            New conversation
          </button>
        ) : null}
      </div>
    </Shell>
  );
}

function Answer({ reply }: { reply: ChatReply }) {
  const [expanded, setExpanded] = useState(false);
  const display = askDisplayRows(reply.data);
  const columns = askTableColumns(display);
  const shown = expanded ? display.length : Math.min(TABLE_PREVIEW, display.length);
  const source = sourceLabel(reply.source);

  return (
    <div className="space-y-[var(--ct-space-3)]">
      <p className="type-prose whitespace-pre-wrap">{reply.answer}</p>
      {columns.length > 0 ? (
        <>
          <ResultTable rows={reply.data} limit={shown} alignNumbers />
          <p className="type-caption">
            {source ? `Source: ${source} · ` : ""}
            {shown} of {display.length} {display.length === 1 ? "row" : "rows"}
            {display.length > TABLE_PREVIEW ? (
              <button
                type="button"
                className="ml-3 text-primary underline underline-offset-2"
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? "Show fewer" : "View full table"}
              </button>
            ) : null}
          </p>
        </>
      ) : (
        <p className="type-caption">No rows behind this answer.</p>
      )}
    </div>
  );
}
