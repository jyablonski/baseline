"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { InjuryPill } from "@/components/injuries/injury-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, queryErrorMessage } from "@/lib/api";
import { playerHref } from "@/lib/nav";
import type { GameInjury, ScheduledGame } from "@/lib/types";
import { cn } from "@/lib/utils";

/** "Hamstring · 18.6 ppg, 9.2 apg", leaving out whatever is not on file. */
function injuryNote(injury: GameInjury) {
  const averages =
    injury.ppg != null && injury.apg != null
      ? `${injury.ppg.toFixed(1)} ppg, ${injury.apg.toFixed(1)} apg`
      : null;
  return [injury.injury_detail, averages].filter(Boolean).join(" · ");
}

function TeamColumn({ team, injuries }: { team: string; injuries: GameInjury[] }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between border-b border-rule pb-1.5">
        <h3 className="font-semibold">{team}</h3>
        <span className="text-sm text-ink-3">{injuries.length} listed</span>
      </div>
      {injuries.length === 0 ? (
        <p className="py-2 text-sm text-ink-3">Nobody listed.</p>
      ) : (
        <ul>
          {injuries.map((injury) => {
            const note = injuryNote(injury);
            return (
              <li
                key={injury.player_id}
                className="border-b border-rule py-2 last:border-b-0"
                data-testid="injury-field-player"
              >
                <div className="flex items-start justify-between gap-2">
                  {injury.player_name ? (
                    <Link
                      href={playerHref(injury.player_name)}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {injury.player_name}
                    </Link>
                  ) : (
                    <span>Unknown player</span>
                  )}
                  <InjuryPill status={injury.injury_status} />
                </div>
                {note ? <p className="type-caption mt-0.5">{note}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Report({ game, away, home }: { game: ScheduledGame; away: string; home: string }) {
  const query = useQuery({
    queryKey: ["game-injuries", game.game_id],
    queryFn: () => api.getGameInjuries(game.game_id),
  });
  if (query.isLoading) return <p className="text-sm text-ink-3">Loading…</p>;
  if (query.isError) {
    return <p className="text-sm text-destructive">{queryErrorMessage(query.error)}</p>;
  }
  const injuries = query.data?.data ?? [];
  return (
    <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
      <TeamColumn team={away} injuries={injuries.filter((injury) => injury.side === "away")} />
      <TeamColumn team={home} injuries={injuries.filter((injury) => injury.side === "home")} />
    </div>
  );
}

/**
 * A game's cell in the schedule's Injuries column: how many are listed, opening
 * both teams' report. Red only when a key player is ruled out; a Day To Day
 * star earns the cell, not the alarm.
 */
export function InjuryField({ game }: { game: ScheduledGame }) {
  const [open, setOpen] = useState(false);
  const away = game.away_team_abbreviation ?? "Away";
  const home = game.home_team_abbreviation ?? "Home";
  const listed = (game.injuries_out ?? 0) + (game.injuries_listed ?? 0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-testid="injury-field"
        className={cn(
          "inline-flex items-baseline gap-1.5 whitespace-nowrap",
          (game.key_players_out ?? 0) > 0 ? "text-destructive" : "text-ink-2 hover:text-foreground"
        )}
      >
        <span className="border-b border-dotted border-current">{listed} listed</span>
        <span aria-hidden className="text-[0.7em]">
          ▾
        </span>
      </PopoverTrigger>
      <PopoverContent
        title={`Injury report · ${away} @ ${home}`}
        aside={<span className="text-sm text-ink-3">Morning report</span>}
        className="w-[min(560px,calc(100vw-24px))]"
      >
        {/* Mounted on open: a slate should not fetch a report per game. */}
        {open ? <Report game={game} away={away} home={home} /> : null}
        <div className="mt-3 flex justify-end border-t border-rule pt-2">
          <Link href={`/games/${game.game_id}`} className="text-sm text-primary">
            Full report →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
