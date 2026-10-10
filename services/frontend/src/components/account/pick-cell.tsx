"use client";

import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  formatMoney,
  formatPrice,
  formatSignedMoney,
  MAX_STAKE,
  pickProfit,
  STAKE_PRESETS,
} from "@/lib/picks";
import type { ScheduledGame, UserPick } from "@/lib/types";
import { cn } from "@/lib/utils";

type SavePick = (pick: { gameId: string; teamId: string; stake: number | null }) => void;

function sidesOf(game: ScheduledGame) {
  return [
    {
      teamId: game.away_team_id,
      label: game.away_team_abbreviation ?? "Away",
      moneyline: game.away_moneyline,
    },
    {
      teamId: game.home_team_id,
      label: game.home_team_abbreviation ?? "Home",
      moneyline: game.home_moneyline,
    },
  ];
}

/**
 * Pick a winner for one scheduled game. Choosing a side saves at once; a stake
 * is a second, optional step in a popover opened from the line underneath.
 */
export function PickCell({
  game,
  pick,
  busy,
  onSave,
  onRemove,
}: {
  game: ScheduledGame;
  pick: UserPick | undefined;
  busy: boolean;
  onSave: SavePick;
  onRemove: (gameId: string) => void;
}) {
  const [staking, setStaking] = useState(false);
  const sides = sidesOf(game);
  const picked = sides.find((side) => side.teamId === pick?.picked_team_id);

  return (
    <div data-testid="pick-cell">
      <div className="flex items-center gap-1.5">
        {sides.map((side) => {
          const active = pick?.picked_team_id === side.teamId;
          return (
            <button
              key={side.teamId}
              type="button"
              // Re-saving the side already taken would only move its timestamp.
              disabled={busy || active}
              aria-pressed={active}
              aria-label={`Pick ${side.label}`}
              onClick={() =>
                onSave({
                  gameId: game.game_id,
                  teamId: side.teamId,
                  // A stake settles at a price, so it only follows the pick to
                  // a side that has one.
                  stake: side.moneyline != null ? (pick?.stake ?? null) : null,
                })
              }
              className={cn(
                "inline-flex h-[var(--ct-control-page)] min-w-12 items-center justify-center border px-2.5 text-sm font-semibold",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-rule bg-raised hover:bg-tint disabled:opacity-50"
              )}
            >
              {side.label}
            </button>
          );
        })}
      </div>
      {pick && picked ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
          {pick.stake && pick.moneyline != null ? (
            <span className="text-primary">
              {formatMoney(pick.stake)} to win {formatMoney(pickProfit(pick.stake, pick.moneyline))}
            </span>
          ) : null}
          {picked.moneyline != null ? (
            <Popover open={staking} onOpenChange={setStaking}>
              <PopoverTrigger
                disabled={busy}
                className="underline underline-offset-2 hover:text-foreground"
              >
                {pick.stake ? "Edit stake" : "Add stake"}
              </PopoverTrigger>
              <PopoverContent
                title={`${picked.label} to win`}
                aside={<span className="tabular text-ink-2">{formatPrice(picked.moneyline)}</span>}
                align="end"
              >
                <StakeEditor
                  game={game}
                  pick={pick}
                  busy={busy}
                  onSave={onSave}
                  onRemove={onRemove}
                  onClose={() => setStaking(false)}
                />
              </PopoverContent>
            </Popover>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(game.game_id)}
            className="underline underline-offset-2 hover:text-foreground"
            aria-label={`Clear pick for ${sides[0].label} at ${sides[1].label}`}
          >
            Clear
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** The optional stake for a pick that is already saved; the body of its popover. */
export function StakeEditor({
  game,
  pick,
  busy,
  onSave,
  onRemove,
  onClose,
}: {
  game: ScheduledGame;
  pick: UserPick;
  busy: boolean;
  onSave: SavePick;
  onRemove: (gameId: string) => void;
  onClose: () => void;
}) {
  const [stake, setStake] = useState<number | null>(pick.stake);
  const [other, setOther] = useState(
    pick.stake && !STAKE_PRESETS.some((preset) => preset === pick.stake) ? String(pick.stake) : ""
  );
  const side = sidesOf(game).find((item) => item.teamId === pick.picked_team_id);
  const moneyline = side?.moneyline ?? null;
  const valid = stake === null || (Number.isInteger(stake) && stake >= 1 && stake <= MAX_STAKE);
  const profit = stake !== null && valid && moneyline != null ? pickProfit(stake, moneyline) : null;

  function chip(value: number | null, label: string) {
    const active = stake === value && other === "";
    return (
      <button
        key={label}
        type="button"
        aria-pressed={active}
        disabled={busy}
        onClick={() => {
          setStake(value);
          setOther("");
        }}
        className={cn(
          "inline-flex h-[var(--ct-control-page)] items-center border px-3 text-sm",
          active
            ? "border-foreground bg-foreground text-background"
            : "border-rule bg-raised hover:bg-tint"
        )}
      >
        {label}
      </button>
    );
  }

  return (
    <form
      className="space-y-3"
      data-testid="stake-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onSave({ gameId: game.game_id, teamId: pick.picked_team_id, stake });
        onClose();
      }}
    >
      <p className="text-ink-2">
        Stake <span className="text-ink-3">· optional, pretend dollars</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {chip(null, "None")}
        {STAKE_PRESETS.map((preset) => chip(preset, formatMoney(preset)))}
        <input
          value={other}
          onChange={(event) => {
            const text = event.target.value;
            setOther(text);
            setStake(text.trim() === "" ? null : Number(text));
          }}
          inputMode="numeric"
          placeholder="$ Other"
          aria-label="Other stake"
          aria-invalid={!valid}
          disabled={busy}
          className={cn(
            "h-[var(--ct-control-page)] w-20 border border-input bg-field px-2 text-sm tabular",
            !valid && "border-destructive"
          )}
        />
      </div>
      <p
        className={cn(
          "border-y border-rule py-2 tabular",
          valid ? "text-foreground" : "text-destructive"
        )}
      >
        {!valid
          ? `Whole dollars, from $1 to ${formatMoney(MAX_STAKE)}.`
          : stake === null || profit === null
            ? "Counts toward your record only"
            : `Returns ${formatMoney(stake + profit)} if ${side?.label} win · net ${formatSignedMoney(profit)}`}
      </p>
      <p className="text-xs text-ink-3">
        Nothing is charged. Stakes only track how your picks would have paid. Locks at tip-off.
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={() => {
            onClose();
            onRemove(game.game_id);
          }}
        >
          Remove pick
        </button>
        <button type="submit" className="btn-fill" disabled={busy || !valid}>
          Save stake
        </button>
      </div>
    </form>
  );
}
