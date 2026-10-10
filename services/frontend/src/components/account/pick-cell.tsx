"use client";

import { useState } from "react";

import { formatMoney, formatPrice, MAX_STAKE, pickProfit, STAKE_PRESETS } from "@/lib/picks";
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
 * is a second, optional step opened from the line underneath.
 */
export function PickCell({
  game,
  pick,
  busy,
  editing,
  onSave,
  onRemove,
  onEditStake,
}: {
  game: ScheduledGame;
  pick: UserPick | undefined;
  busy: boolean;
  /** Whether this game's stake editor is open. */
  editing: boolean;
  onSave: SavePick;
  onRemove: (gameId: string) => void;
  onEditStake: (gameId: string) => void;
}) {
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
          {picked.moneyline != null && !editing ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onEditStake(game.game_id)}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {pick.stake ? "Edit stake" : "Add stake"}
            </button>
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

/** The optional stake for a pick that is already saved. */
export function StakeEditor({
  game,
  pick,
  busy,
  onSave,
  onClose,
}: {
  game: ScheduledGame;
  pick: UserPick;
  busy: boolean;
  onSave: SavePick;
  onClose: () => void;
}) {
  const [stake, setStake] = useState<number | null>(pick.stake);
  const [other, setOther] = useState(
    pick.stake && !STAKE_PRESETS.some((preset) => preset === pick.stake) ? String(pick.stake) : ""
  );
  const side = sidesOf(game).find((item) => item.teamId === pick.picked_team_id);
  const moneyline = side?.moneyline ?? null;
  const valid = stake === null || (Number.isInteger(stake) && stake >= 1 && stake <= MAX_STAKE);

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
      className="flex flex-wrap items-center justify-end gap-2 py-1"
      data-testid="stake-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onSave({ gameId: game.game_id, teamId: pick.picked_team_id, stake });
        onClose();
      }}
    >
      <span className="text-sm text-ink-2">
        Stake on {side?.label} {formatPrice(moneyline)} (optional)
      </span>
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
      <span className={cn("min-w-[13rem] text-sm", valid ? "text-ink-2" : "text-destructive")}>
        {!valid
          ? `Whole dollars, from $1 to ${formatMoney(MAX_STAKE)}.`
          : stake === null || moneyline == null
            ? "Counts toward your record only"
            : `${formatMoney(stake)} to win ${formatMoney(pickProfit(stake, moneyline))}`}
      </span>
      <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
        Cancel
      </button>
      <button type="submit" className="btn-fill" disabled={busy || !valid}>
        Save stake
      </button>
    </form>
  );
}
