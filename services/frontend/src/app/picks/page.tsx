"use client";

import { useState } from "react";
import Link from "next/link";

import { PickGameLink, SettledPicks } from "@/components/account/settled-picks";
import { SignInPrompt } from "@/components/account/sign-in-prompt";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { KpiCard, KpiStrip, KpiTitle } from "@/components/ui/kpi-card";
import { usePicks } from "@/hooks/use-picks";
import { useProfile } from "@/hooks/use-profile";
import { useAccount, useFeatures } from "@/lib/account";
import { queryErrorMessage } from "@/lib/api";
import { formatShortDate, seasonFromDate } from "@/lib/format";
import {
  bestCall,
  finalScore,
  formatMoney,
  formatSignedMoney,
  openSummary,
  percentCorrect,
  pickLabel,
  pickProfit,
  picksCsv,
  pickTotals,
  recentForm,
} from "@/lib/picks";
import { formatGameTime } from "@/lib/timezones";
import type { PickSheet, UserPick } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  return <Sheet sheet={picks.sheet} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <h1 className="type-page">Picks</h1>
      {children}
    </div>
  );
}

function downloadCsv(picks: UserPick[]) {
  const url = URL.createObjectURL(new Blob([picksCsv(picks)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "baseline-picks.csv";
  // Attached and revoked a tick later: some browsers drop a download whose
  // link is not in the document or whose URL is gone before it starts.
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Sheet({ sheet }: { sheet: PickSheet }) {
  const { summary, picks } = sheet;
  const open = picks.filter((pick) => pick.result === "pending");
  // Void picks sit with the settled ones: they are finished, just not graded.
  const settled = picks.filter((pick) => pick.result !== "pending");
  const best = bestCall(picks);
  const staked = picks.filter((pick) => pick.profit != null).length;
  const { staked: stakedTotal } = pickTotals(picks);
  const season = seasonFromDate(picks[0]?.game_date ?? new Date().toISOString());

  return (
    <div className="space-y-[var(--ct-space-5)]">
      <header className="flex items-center gap-[var(--ct-space-4)]">
        <div className="min-w-0">
          <h1 className="type-page truncate">Your picks</h1>
          <p className="mt-1 text-ink-2">{season} season · stakes are pretend dollars</p>
        </div>
        {picks.length > 0 ? (
          <button
            type="button"
            className="btn-ghost ml-auto shrink-0 whitespace-nowrap"
            onClick={() => downloadCsv(picks)}
          >
            Download CSV
          </button>
        ) : null}
      </header>

      <KpiStrip>
        <KpiCard
          label="Record"
          value={`${summary.wins}–${summary.losses}`}
          progress={
            summary.wins + summary.losses > 0
              ? summary.wins / (summary.wins + summary.losses)
              : undefined
          }
          note={percentCorrect(summary.wins, summary.losses) ?? "no finished games yet"}
        />
        <KpiCard
          label="Net"
          value={formatSignedMoney(summary.net)}
          note={
            [
              staked > 0 ? `from ${staked} settled ${staked === 1 ? "stake" : "stakes"}` : null,
              staked > 0 ? `${formatMoney(stakedTotal)} staked` : null,
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
              ? "right when the model was wrong, minus the reverse"
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

      <RecentForm picks={picks} />

      {picks.length === 0 ? (
        <EmptyState
          title="No picks yet"
          message="Pick a winner for any upcoming game on the schedule."
        />
      ) : null}

      <OpenPicks picks={open} />

      {settled.length > 0 ? <SettledPicks picks={settled} /> : null}
    </div>
  );
}

/** W/L tiles for the last 20 graded picks, newest on the right. */
function RecentForm({ picks }: { picks: UserPick[] }) {
  const form = recentForm(picks);
  const size = form.picks.length;
  if (size === 0) return null;
  return (
    <section
      aria-label="Recent form"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule pb-3"
    >
      <span className="type-caption">Last {size}</span>
      <ol className="flex flex-wrap gap-1">
        {form.picks.map((pick) => (
          <li
            key={pick.game_id}
            data-testid="form-tile"
            title={`${formatShortDate(pick.game_date)}: ${pickLabel(pick)}`}
            className={cn(
              "grid size-6 place-items-center text-[var(--ct-fs-meta)] font-semibold",
              pick.result === "won"
                ? "bg-primary text-primary-foreground"
                : "bg-destructive/10 text-destructive"
            )}
          >
            {pick.result === "won" ? "W" : "L"}
          </li>
        ))}
      </ol>
      <span className="text-sm text-ink-2">
        {form.wins}–{form.losses} over the last {size}
        {form.trend ? ` · ${form.trend}` : ""}
      </span>
    </section>
  );
}

function OpenPicks({ picks }: { picks: UserPick[] }) {
  const [expanded, setExpanded] = useState(false);
  const { timezone } = useProfile();
  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule-strong pb-2">
        <h2 className="type-module">Open</h2>
        {picks.length === 0 ? (
          <p className="type-caption">Nothing open. Picks lock when a game tips.</p>
        ) : (
          <>
            <p className="text-sm text-ink-2">{openSummary(picks, timezone)}</p>
            <button
              type="button"
              aria-expanded={expanded}
              className="text-sm text-primary"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? "Hide" : "Show"} <span aria-hidden>{expanded ? "▲" : "▼"}</span>
            </button>
          </>
        )}
        <Link href="/schedule" className="ml-auto text-sm text-primary">
          Schedule →
        </Link>
      </div>
      {expanded ? (
        <ul>
          {picks.map((pick) => {
            const tip = formatGameTime(pick.game_date, pick.start_time_et, timezone);
            return (
              <li
                key={pick.game_id}
                className="flex items-center gap-[var(--ct-space-4)] border-b border-rule py-3"
                data-testid="open-pick"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    <PickGameLink pick={pick} />
                  </p>
                  <p className="type-caption mt-0.5">
                    {tip.date}
                    {tip.zone ? ` · ${tip.time} ${tip.zone}` : ""}
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
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
