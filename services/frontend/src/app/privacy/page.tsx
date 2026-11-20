import type { Metadata } from "next";
import Link from "next/link";

import { WhenChatbot } from "@/components/account/when-chatbot";
import { Section } from "@/components/layout/section";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <article className="space-y-8">
      <header>
        <h1 className="type-page">Privacy</h1>
        <p className="type-prose mt-1">
          Baseline can be read without an account, and nothing is collected about visitors who do
          not sign in, unless they send feedback. There are no analytics, advertising or tracking
          scripts on this site.
        </p>
        <p className="type-prose mt-1 text-ink-2">Effective November 19, 2026.</p>
      </header>

      <Section title="What is kept when you sign in">
        <p>
          Signing in with GitHub or Google is optional and is only needed to make picks
          <WhenChatbot>, use chat</WhenChatbot> or follow teams. When you sign in, Baseline keeps:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>Your display name and the account id the provider assigns you.</li>
          <li>Your picks, with any stake you put on them.</li>
          <li>The teams you follow, if any.</li>
          <li>Your time zone setting, if you choose one.</li>
          <WhenChatbot>
            <li>
              A usage record for each chat question you ask: when it was asked and how large the
              answer was. The text of a question is not stored.
            </li>
          </WhenChatbot>
        </ul>
        <p className="mt-3">
          Your email address is not stored. Baseline never sees your GitHub or Google password and
          asks the provider for nothing beyond your basic profile.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          One cookie keeps you signed in. It is encrypted and holds the name, email address and
          picture the provider sent when you signed in. It is read to recognise you on each visit
          and is not saved anywhere else. Signing out removes it.
        </p>
      </Section>

      <WhenChatbot>
        <Section title="Chat">
          <p>
            A question asked in chat may be sent to a third-party AI model provider so that it can
            be answered.
          </p>
        </Section>
      </WhenChatbot>

      <Section title="Feedback">
        <p>
          Anyone can send a report from the{" "}
          <Link className="underline underline-offset-2" href="/feedback">
            feedback page
          </Link>
          , signed in or not. A report keeps:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>What you wrote, and which kind of report it is.</li>
          <li>The page it was sent from, if any.</li>
          <li>An email address, only if you give one for a reply.</li>
          <li>Your account id, if you were signed in.</li>
          <li>
            A one-way hash of your IP address, used only to limit how often one address can send
            reports. The address itself is not stored.
          </li>
        </ul>
        <p className="mt-3">Reports are read only to fix and improve Baseline.</p>
      </Section>

      <Section title="How it is used">
        <p>
          What is kept is used only to run your account: showing your picks and their results,
          highlighting the teams you follow and linking them from the header, and showing game times
          in your time zone
          <WhenChatbot>, and applying the daily chat limit</WhenChatbot>. It is not sold, not shared
          with anyone else, and not used for advertising.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          You can delete your account at any time from the{" "}
          <Link className="underline underline-offset-2" href="/account">
            account page
          </Link>
          . That removes your account, your picks and your usage history, and cannot be undone. Any
          feedback you sent is kept, no longer linked to you.
        </p>
      </Section>
    </article>
  );
}
