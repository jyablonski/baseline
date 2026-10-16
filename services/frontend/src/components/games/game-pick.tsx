import Link from "next/link";

import { TeamLogo } from "@/components/team-logo";
import { usePicks } from "@/hooks/use-picks";
import { useAccount, useFeatures } from "@/lib/account";
import { queryErrorMessage } from "@/lib/api";
import { formatSpread } from "@/lib/format";
import {
  formatMoney,
  formatPrice,
  formatSignedMoney,
  pickLabel,
  pickProfit,
  STAKE_PRESETS,
} from "@/lib/picks";
import type { GameDetail, UserPick } from "@/lib/types";
import { cn } from "@/lib/utils";

const RESULT_LABEL = { won: "Won", lost: "Lost", void: "Void", pending: "Open" } as const;

/** The vigged probability an American price implies, as the book quotes it. */
export function impliedProbability(moneyline: number | null | undefined) {
  if (moneyline == null) return null;
  return moneyline < 0 ? -moneyline / (-moneyline + 100) : 100 / (moneyline + 100);
}

/** "NYK −150 · Won · +$6.67", for the recap. */
export function pickSummary(pick: UserPick) {
  const parts = [pickLabel(pick), RESULT_LABEL[pick.result]];
  if (pick.profit != null) parts.push(formatSignedMoney(pick.profit));
  return parts.join(" · ");
}

/**
 * Pick a winner before tip-off: one card per team with its price, then an
 * optional stake. Signed out, a card leads to sign-in; after tip it is locked.
 */
export function WhoWins({ game, tipped }: { game: GameDetail; tipped: boolean }) {
  const features = useFeatures();
  const { account, isLoading: accountIsLoading } = useAccount();
  const picks = usePicks();
  const pick = picks.sheet?.picks.find((item) => item.game_id === game.game_id);
  const canPick = features.picks && Boolean(picks.sheet) && !tipped;
  const signInHref =
    features.picks && !accountIsLoading && !account && !tipped
      ? `/signin?callbackUrl=${encodeURIComponent(`/games/${game.game_id}`)}`
      : null;
  const busy = picks.save.isPending || picks.remove.isPending;
  const error = picks.save.error ?? picks.remove.error ?? picks.error;

  const cards = [
    {
      teamId: game.away_team_id,
      name: game.away_team_name ?? game.away_team_abbreviation ?? "Away",
      abbreviation: game.away_team_abbreviation ?? "Away",
      side: "Away",
      moneyline: game.away_moneyline,
    },
    {
      teamId: game.home_team_id,
      name: game.home_team_name ?? game.home_team_abbreviation ?? "Home",
      abbreviation: game.home_team_abbreviation ?? "Home",
      side: "Home",
      moneyline: game.home_moneyline,
    },
  ];
  const picked = cards.find((card) => card.teamId === pick?.picked_team_id);
  const spread =
    game.home_spread == null
      ? null
      : `Spread ${game.home_team_abbreviation} ${formatSpread(game.home_spread)}`;
  const lockNote = features.picks ? (tipped ? "picks locked" : "picks lock at tip-off") : null;

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
        <h2 className="type-module">Who wins?</h2>
        <p className="text-sm text-ink-2">{[spread, lockNote].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {cards.map((card) => {
          const active = card.teamId === pick?.picked_team_id;
          const implied = impliedProbability(card.moneyline);
          const body = (
            <>
              <span className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-semibold">
                  <TeamLogo teamId={card.teamId} abbreviation={card.abbreviation} />
                  {card.name}
                </span>
                <span className="font-semibold tabular">
                  {card.moneyline == null ? "—" : formatPrice(card.moneyline)}
                </span>
              </span>
              <span
                className={cn(
                  "mt-0.5 flex justify-between text-xs",
                  active ? "text-primary-foreground/80" : "text-ink-2"
                )}
              >
                <span>{card.side}</span>
                <span>{implied == null ? "" : `Implied ${Math.round(implied * 100)}%`}</span>
              </span>
            </>
          );
          const className = cn(
            "block w-full border px-4 py-2.5 text-left",
            active ? "border-primary bg-primary text-primary-foreground" : "border-rule bg-raised",
            (canPick || signInHref) && !active && "hover:border-primary"
          );
          if (signInHref) {
            return (
              <Link
                key={card.teamId}
                href={signInHref}
                className={className}
                data-testid="pick-card"
              >
                {body}
              </Link>
            );
          }
          return (
            <button
              key={card.teamId}
              type="button"
              disabled={!canPick || busy || active}
              aria-pressed={active}
              aria-label={`Pick ${card.name}`}
              onClick={() =>
                picks.save.mutate({
                  gameId: game.game_id,
                  teamId: card.teamId,
                  // A stake settles at a price, so it only follows the pick
                  // to a side that has one.
                  stake: card.moneyline != null ? (pick?.stake ?? null) : null,
                })
              }
              className={cn(className, "disabled:cursor-default")}
              data-testid="pick-card"
            >
              {body}
            </button>
          );
        })}
      </div>

      {pick && picked && !tipped && canPick ? (
        <StakeRow
          pick={pick}
          abbreviation={picked.abbreviation}
          hasPrice={pick.moneyline != null}
          busy={busy}
          onStake={(stake) =>
            picks.save.mutate({ gameId: game.game_id, teamId: pick.picked_team_id, stake })
          }
          onClear={() => picks.remove.mutate(game.game_id)}
        />
      ) : null}
      {pick && tipped ? (
        <p className="mt-3 text-sm" data-testid="game-pick-result">
          Your pick: {pickSummary(pick)}
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {queryErrorMessage(error)}
        </p>
      ) : null}
      <p className="type-caption mt-3">
        {features.picks ? "Stakes are for tracking only. " : ""}
        Odds are the sportsbook consensus, not betting advice.{" "}
        <Link href="/predictions" className="text-primary underline-offset-2 hover:underline">
          How accurate is the model?
        </Link>
      </p>
    </section>
  );
}

function StakeRow({
  pick,
  abbreviation,
  hasPrice,
  busy,
  onStake,
  onClear,
}: {
  pick: UserPick;
  abbreviation: string;
  hasPrice: boolean;
  busy: boolean;
  onStake: (stake: number | null) => void;
  onClear: () => void;
}) {
  const options: (number | null)[] = hasPrice ? [null, ...STAKE_PRESETS] : [null];
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-2 border border-rule bg-raised px-3 py-2 text-sm"
      data-testid="stake-row"
    >
      <span className="text-ink-2">Stake</span>
      {options.map((stake) => {
        const active = (pick.stake ?? null) === stake;
        return (
          <button
            key={stake ?? "none"}
            type="button"
            disabled={busy || active}
            aria-pressed={active}
            onClick={() => onStake(stake)}
            className={cn(
              "border px-2.5 py-1 tabular",
              active ? "border-foreground bg-foreground text-background" : "border-rule"
            )}
          >
            {stake == null ? "None" : formatMoney(stake)}
          </button>
        );
      })}
      <span className="text-primary">
        {pick.stake && pick.moneyline != null
          ? `${abbreviation} · ${formatMoney(pick.stake)} to win ${formatMoney(pickProfit(pick.stake, pick.moneyline))}`
          : `${abbreviation} · record only`}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={onClear}
        className="ml-auto text-ink-2 hover:text-foreground"
      >
        Clear
      </button>
    </div>
  );
}
