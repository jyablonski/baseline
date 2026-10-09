"use client";

import { useState } from "react";
import Link from "next/link";

import { SignInPrompt } from "@/components/account/sign-in-prompt";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { KpiCard, KpiStrip, KpiTitle } from "@/components/ui/kpi-card";
import { usePicks } from "@/hooks/use-picks";
import { useAccount, useFeatures } from "@/lib/account";
import { queryErrorMessage } from "@/lib/api";
import { formatScheduleDate, formatTimeET } from "@/lib/format";
import {
  bestCall,
  finalScore,
  formatMoney,
  formatSignedMoney,
  pickLabel,
  pickProfit,
} from "@/lib/picks";
import type { PickSheet, UserPick } from "@/lib/types";
import { cn } from "@/lib/utils";

// A season is hundreds of games; the newest are what a visitor came to see.
const SETTLED_PAGE = 20;

export default function PicksPage() {
  const { account, isLoading: accountIsLoading } = useAccount();
  const features = useFeatures();
  const picks = usePicks();

  if (accountIsLoading || features.isLoading) {
    return (
      <Shell>
        <LoadingState label="Loading picks…" />
      </Shell>
    );
  }
  if (!features.picks) {
    return (
      <Shell>
        <EmptyState title="Picks are paused" message="Picks are turned off for now." />
      </Shell>
    );
  }
  if (!account) {
    return (
      <Shell>
        <SignInPrompt returnTo="/picks">
          Sign in to pick winners on the schedule and keep a record.
        </SignInPrompt>
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
  if (picks.isLoading) {
    return (
      <Shell>
        <LoadingState label="Loading picks…" />
      </Shell>
    );
  }
  if (picks.error || !picks.sheet) {
    return (
      <Shell>
        <ErrorState message={queryErrorMessage(picks.error)} />
      </Shell>
    );
  }
  return <Sheet name={account.name || "Your picks"} sheet={picks.sheet} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <h1 className="type-page">Picks</h1>
      {children}
    </div>
  );
}

function Sheet({ name, sheet }: { name: string; sheet: PickSheet }) {
  const { summary, picks } = sheet;
  const settledCount = summary.wins + summary.losses;
  const open = picks.filter((pick) => pick.result === "pending");
  // Void picks sit with the settled ones: they are finished, just not graded.
  const settled = picks.filter((pick) => pick.result !== "pending");
  const best = bestCall(picks);
  const staked = picks.filter((pick) => pick.profit != null).length;
  const since = picks.map((pick) => pick.created_at).sort()[0];

  return (
    <div className="space-y-[var(--ct-space-5)]">
      <header className="flex items-center gap-[var(--ct-space-4)]">
        <span
          aria-hidden="true"
          className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground"
        >
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h1 className="type-page truncate">{name}</h1>
          <p className="mt-1 text-sm text-ink-2">
            {since
              ? `Picking since ${new Date(since).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
              : "No picks yet"}
          </p>
        </div>
      </header>

      <KpiStrip>
        <KpiCard
          label="Record"
          value={`${summary.wins}–${summary.losses}`}
          progress={settledCount > 0 ? summary.wins / settledCount : undefined}
          note={
            settledCount > 0
              ? `${Math.round((summary.wins / settledCount) * 100)}% correct`
              : "no finished games yet"
          }
        />
        <KpiCard
          label="Net"
          value={formatSignedMoney(summary.net)}
          note={
            [
              staked > 0 ? `from ${staked} settled ${staked === 1 ? "stake" : "stakes"}` : null,
              summary.staked_open > 0
                ? `${formatMoney(summary.staked_open)} riding on open picks`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || "stakes are optional; nothing staked yet"
          }
        />
        <KpiCard
          label="Vs. the model"
          value={
            summary.model_games > 0
              ? `${summary.vs_model > 0 ? "+" : summary.vs_model < 0 ? "−" : ""}${Math.abs(summary.vs_model)}`
              : "—"
          }
          note={
            summary.model_games > 0
              ? `net games ahead of Baseline's model over ${summary.model_games}`
              : "no finished games the model also called"
          }
        />
        <KpiCard
          label="Best call"
          value={
            best ? (
              <KpiTitle>{pickLabel(best)}</KpiTitle>
            ) : (
              <KpiTitle className="text-ink-3">—</KpiTitle>
            )
          }
          note={
            best
              ? best.stake && best.profit
                ? `${formatMoney(best.stake)} staked, won ${formatMoney(best.profit)}`
                : finalScore(best)
              : "your best win will show here"
          }
        />
      </KpiStrip>

      {picks.length === 0 ? (
        <EmptyState
          title="No picks yet"
          message="Pick a winner for any upcoming game on the schedule."
        />
      ) : null}

      <section>
        <div className="flex items-baseline justify-between border-b border-rule-strong pb-2">
          <h2 className="type-module">Open picks</h2>
          <Link href="/schedule" className="text-sm text-primary">
            Schedule →
          </Link>
        </div>
        {open.length === 0 ? (
          <p className="type-caption py-3">Nothing open. Picks lock when a game tips.</p>
        ) : (
          <ul>
            {open.map((pick) => (
              <li
                key={pick.game_id}
                className="flex items-center gap-[var(--ct-space-4)] border-b border-rule py-3"
                data-testid="open-pick"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{pickLabel(pick)}</p>
                  <p className="type-caption mt-0.5">
                    {formatScheduleDate(pick.game_date)}
                    {pick.start_time_et ? ` · ${formatTimeET(pick.start_time_et)}` : ""}
                  </p>
                </div>
                <span className="tabular w-14 text-right">
                  {pick.stake ? formatMoney(pick.stake) : "–"}
                </span>
                <span className="type-caption w-24 text-right whitespace-nowrap">
                  {pick.stake && pick.moneyline != null
                    ? `to win ${formatMoney(pickProfit(pick.stake, pick.moneyline))}`
                    : "record only"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {settled.length > 0 ? <Settled picks={settled} /> : null}
    </div>
  );
}

function Settled({ picks }: { picks: UserPick[] }) {
  const [shown, setShown] = useState(SETTLED_PAGE);
  return (
    <section>
      <h2 className="type-module border-b border-rule-strong pb-2">Settled</h2>
      <ul>
        {picks.slice(0, shown).map((pick) => (
          <li
            key={pick.game_id}
            className="flex items-baseline gap-[var(--ct-space-3)] border-b border-rule py-3"
            data-testid="settled-pick"
          >
            {/* A letter as well as a colour, so the result does not rest on hue. */}
            <span
              className={cn(
                "w-4 shrink-0 text-[var(--ct-fs-meta)] font-semibold",
                pick.result === "won" && "text-primary",
                pick.result === "lost" && "text-destructive",
                pick.result === "void" && "text-ink-3"
              )}
              title={pick.result === "won" ? "Won" : pick.result === "lost" ? "Lost" : "Void"}
            >
              {pick.result === "won" ? "W" : pick.result === "lost" ? "L" : "–"}
            </span>
            <span className="font-medium">{pickLabel(pick)}</span>
            <span className="type-caption">{finalScore(pick)}</span>
            <span className="type-caption tabular ml-auto w-14 text-right">
              {pick.stake ? formatMoney(pick.stake) : "–"}
            </span>
            <span
              className={cn(
                "tabular w-20 text-right",
                (pick.profit ?? 0) > 0 && "text-primary",
                (pick.profit ?? 0) < 0 && "text-destructive"
              )}
            >
              {pick.profit == null ? "–" : formatSignedMoney(pick.profit)}
            </span>
          </li>
        ))}
      </ul>
      {picks.length > shown ? (
        <button
          type="button"
          className="btn-ghost mt-3"
          onClick={() => setShown((current) => current + SETTLED_PAGE)}
        >
          Show {Math.min(SETTLED_PAGE, picks.length - shown)} more
        </button>
      ) : null}
    </section>
  );
}
