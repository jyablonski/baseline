"use client";

import { useActionState, useState } from "react";

import { sendFeedbackAction, type FeedbackState } from "@/app/feedback/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFeatures } from "@/lib/account";
import { CONTACT_EMAIL } from "@/lib/contact";
import {
  FEEDBACK_KINDS,
  MAX_FEEDBACK_CHARS,
  MIN_FEEDBACK_CHARS,
  type FeedbackKind,
} from "@/lib/feedback";

const IDLE: FeedbackState = { status: "idle" };

export function FeedbackForm({ kind, pagePath }: { kind: FeedbackKind; pagePath: string | null }) {
  const [state, formAction, pending] = useActionState(sendFeedbackAction, IDLE);
  // Controlled, because React resets a form after its action runs and a
  // refused send must not clear what was typed.
  const [chosenKind, setChosenKind] = useState(kind);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const features = useFeatures();

  if (state.status === "sent") {
    return (
      <p className="type-prose" role="status">
        Thanks, got it.
      </p>
    );
  }

  // While the flags load the form shows: off is the rare case, and a flash of
  // the fallback on every visit would be worse than one refused send.
  if (state.status === "off" || (!features.isLoading && !features.feedback)) {
    return (
      <p className="type-prose">
        The form is closed right now. Email{" "}
        <a className="underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>{" "}
        instead.
      </p>
    );
  }

  return (
    <form action={formAction} className="max-w-xl space-y-5">
      <fieldset className="space-y-2">
        <legend className="type-module mb-2">What is this about?</legend>
        {FEEDBACK_KINDS.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="kind"
              value={option.value}
              checked={option.value === chosenKind}
              onChange={() => setChosenKind(option.value)}
              required
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="feedback-message" className="type-module block">
          What happened?
        </label>
        <p className="text-sm text-ink-2">
          For a wrong number, name the game or player and what looks off.
        </p>
        <textarea
          id="feedback-message"
          name="message"
          className="field min-h-36 w-full py-2"
          minLength={MIN_FEEDBACK_CHARS}
          maxLength={MAX_FEEDBACK_CHARS}
          required
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <p className="type-caption text-right">
          {message.length}/{MAX_FEEDBACK_CHARS}
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="feedback-email" className="type-module block">
          Email <span className="font-normal text-ink-2">(optional)</span>
        </label>
        <p className="text-sm text-ink-2">Only if you would like a reply.</p>
        <Input
          id="feedback-email"
          name="reply_email"
          type="email"
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      {pagePath ? <input type="hidden" name="page_path" value={pagePath} /> : null}

      {/* The honeypot. Off-screen and out of the tab order, so only a bot fills it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="feedback-website">Website</label>
        <input id="feedback-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {state.status === "error" ? (
        <p className="bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send"}
      </Button>
    </form>
  );
}
