import Link from "next/link";

import { formatScheduleDate } from "@/lib/format";
import { playerHref } from "@/lib/nav";
import type { InjuryStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type InjuryEntry = {
  player_id: string;
  player_name: string | null;
  injury_status: InjuryStatus;
  injury_detail: string | null;
  description: string;
  update_date: string | null;
  is_notable: boolean;
  played?: boolean | null;
};

/** A status as a small tag: ruled out reads in the alarm colour, a doubt does not. */
export function InjuryPill({ status, detail }: { status: InjuryStatus; detail?: string | null }) {
  const out = status === "Out" || status === "Out For Season";
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap border px-1.5 py-0.5 text-xs font-semibold",
        out ? "border-destructive text-destructive" : "border-rule text-ink-2"
      )}
      data-testid="injury-pill"
    >
      {status}
      {detail ? <span className="font-normal">{` · ${detail}`}</span> : null}
    </span>
  );
}

/** Players on an injury report, notable ones first as the API orders them. */
export function InjuryList({ injuries }: { injuries: InjuryEntry[] }) {
  return (
    <ul>
      {injuries.map((injury) => (
        <li
          key={injury.player_id}
          className="border-b border-rule py-2 text-sm"
          data-testid="injury-row"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {injury.player_name ? (
              <Link
                href={playerHref(injury.player_name)}
                className={cn(
                  "hover:text-primary hover:underline",
                  injury.is_notable && "font-semibold"
                )}
              >
                {injury.player_name}
              </Link>
            ) : (
              <span>Unknown player</span>
            )}
            <InjuryPill status={injury.injury_status} detail={injury.injury_detail} />
            {injury.played != null ? (
              <span className="text-xs text-ink-2">
                {injury.played ? "Played" : "Did not play"}
              </span>
            ) : null}
          </div>
          <p className="type-caption mt-0.5">
            {injury.description}
            {injury.update_date ? ` (updated ${formatScheduleDate(injury.update_date)})` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
