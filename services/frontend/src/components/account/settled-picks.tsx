"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { formatShortDate } from "@/lib/format";
import {
  filterSettled,
  finalScore,
  formatMoney,
  formatSignedMoney,
  modelTeam,
  percentCorrect,
  PICK_SPLITS,
  pickedTeam,
  pickLabel,
  pickTotals,
  splitLabel,
  toggleSplit,
  type SettledFilters,
} from "@/lib/picks";
import type { UserPick } from "@/lib/types";
import { cn } from "@/lib/utils";

// A season is hundreds of games; the newest are what a visitor came to see.
const SETTLED_PAGE = 20;

const RANGES = [
  { value: "week", label: "Last 7 days" },
  { value: "season", label: "Season" },
] as const;

const RESULTS = [
  { value: "all", label: "All" },
  { value: "won", label: "Wins" },
  { value: "lost", label: "Losses" },
] as const;

/** A pick's label, linking to its game unless the game has left the schedule. */
export function PickGameLink({ pick, wholeRow = false }: { pick: UserPick; wholeRow?: boolean }) {
  if (pick.result === "void") return <>{pickLabel(pick)}</>;
  return (
    <Link
      href={`/games/${pick.game_id}`}
      className={cn(
        "hover:text-primary hover:underline",
        // Stretched over the row, which is the positioned ancestor, so the row
        // opens the game and is still one real link for keyboards.
        wholeRow && "after:absolute after:inset-0"
      )}
    >
      {pickLabel(pick)}
    </Link>
  );
}

function Segments<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex border border-input bg-field">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "seg-btn normal-case",
            value === option.value && "bg-foreground text-background"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SettledSummary({ picks }: { picks: UserPick[] }) {
  const { wins, losses, net, staked } = pickTotals(picks);
  const correct = percentCorrect(wins, losses);
  return (
    <p className="text-sm" data-testid="settled-summary">
      <span className="font-semibold">
        {picks.length} {picks.length === 1 ? "pick" : "picks"}
      </span>
      {` · ${wins}–${losses}`}
      {correct ? ` · ${correct}` : ""}
      {staked > 0 ? (
        <>
          {" · "}
          <span
            className={cn(
              "font-semibold",
              net > 0 && "text-primary",
              net < 0 && "text-destructive"
            )}
          >
            Net {formatSignedMoney(net)}
          </span>
          <span className="text-ink-3"> on {formatMoney(staked)} staked</span>
        </>
      ) : null}
    </p>
  );
}

/** Each split's record and net. Clicking one filters the list and adds a chip. */
function Breakdown(props: BreakdownProps) {
  return (
    <Popover>
      <PopoverTrigger className="field inline-flex items-center gap-2 px-3">
        Breakdown <span aria-hidden>▼</span>
      </PopoverTrigger>
      <PopoverContent title="Breakdown" align="end" className="w-[min(320px,calc(100vw-24px))]">
        <BreakdownSplits {...props} />
      </PopoverContent>
    </Popover>
  );
}

type BreakdownProps = {
  picks: UserPick[];
  filters: SettledFilters;
  onToggle: (id: string) => void;
};

/** Its own component so the totals are only worked out while the menu is open. */
function BreakdownSplits({ picks, filters, onToggle }: BreakdownProps) {
  return (
    <div className="space-y-3">
      {PICK_SPLITS.map((group) => {
        // A row counts what clicking it would show, so its own group's
        // choice is set aside.
        const others = filters.splits.filter(
          (id) => !group.splits.some((split) => split.id === id)
        );
        const rest = filterSettled(picks, { ...filters, splits: others });
        return (
          <div key={group.label}>
            <p className="type-eyebrow">{group.label}</p>
            {group.splits.map((split) => {
              const { wins, losses, net, staked } = pickTotals(rest.filter(split.test));
              return (
                <button
                  key={split.id}
                  type="button"
                  aria-pressed={filters.splits.includes(split.id)}
                  onClick={() => onToggle(split.id)}
                  className={cn(
                    "tabular flex w-full items-baseline gap-3 px-1 py-1 text-left hover:bg-tint",
                    filters.splits.includes(split.id) && "bg-tint font-semibold"
                  )}
                >
                  <span className="flex-1">{split.label}</span>
                  <span>
                    {wins}–{losses}
                  </span>
                  <span className="w-16 text-right text-ink-2">
                    {staked > 0 ? formatSignedMoney(net) : "–"}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${label} filter`}
      onClick={onRemove}
      className="inline-flex h-[var(--ct-control-page)] items-center gap-2 border border-foreground px-3 text-sm"
    >
      {label} <span aria-hidden>×</span>
    </button>
  );
}

/** A letter as well as a colour, so the result does not rest on hue. */
function ResultMark({ pick }: { pick: UserPick }) {
  return (
    <span
      className={cn(
        "font-semibold",
        pick.result === "won" && "text-primary",
        pick.result === "lost" && "text-destructive",
        pick.result === "void" && "text-ink-3"
      )}
      title={pick.result === "won" ? "Won" : pick.result === "lost" ? "Lost" : "Void"}
    >
      {pick.result === "won" ? "W" : pick.result === "lost" ? "L" : "–"}
    </span>
  );
}

function ModelCall({ pick }: { pick: UserPick }) {
  const team = modelTeam(pick);
  if (!team) return <span className="text-ink-3">–</span>;
  return (
    <span className={pick.model_correct ? "text-primary" : "text-destructive"}>
      {team} {pick.model_correct ? "W" : "L"}
    </span>
  );
}

function SettledRow({ pick, showModel }: { pick: UserPick; showModel: boolean }) {
  const profit = pick.profit ?? 0;
  return (
    <tr className="relative" data-testid="settled-pick">
      <td className="whitespace-nowrap text-ink-2">{formatShortDate(pick.game_date)}</td>
      <td>
        <ResultMark pick={pick} />
      </td>
      <td>
        <span className="font-semibold">
          <PickGameLink pick={pick} wholeRow />
        </span>
        {pick.result === "won" && pick.is_upset ? (
          <span
            className="type-eyebrow mt-1 block w-fit border border-primary/40 bg-tint px-2 py-0.5 font-semibold tracking-normal whitespace-nowrap text-primary sm:mt-0 sm:ml-2 sm:inline-block"
            data-testid="called-upset"
          >
            Called the upset
          </span>
        ) : null}
      </td>
      <td className="whitespace-nowrap text-ink-2">{finalScore(pick)}</td>
      {showModel ? (
        <td className="whitespace-nowrap">
          <ModelCall pick={pick} />
        </td>
      ) : null}
      <td
        className={cn(
          "tabular text-right whitespace-nowrap max-sm:hidden",
          !pick.stake && "text-ink-3"
        )}
      >
        {pick.stake ? formatMoney(pick.stake) : pick.result === "void" ? "–" : "Record only"}
      </td>
      <td
        className={cn(
          "tabular pr-0 text-right font-semibold whitespace-nowrap",
          profit > 0 && "text-primary",
          profit < 0 && "text-destructive"
        )}
      >
        {pick.profit == null ? null : formatSignedMoney(pick.profit)}
      </td>
    </tr>
  );
}

export function SettledPicks({ picks }: { picks: UserPick[] }) {
  const [shown, setShown] = useState(SETTLED_PAGE);
  const [showModel, setShowModel] = useState(false);
  const [filters, setFilters] = useState<SettledFilters>({
    range: "season",
    result: "all",
    team: "",
    splits: [],
  });
  const teams = useMemo(
    () => [...new Set(picks.map(pickedTeam).filter((team) => team != null))].sort(),
    [picks]
  );
  const rows = useMemo(() => filterSettled(picks, filters), [picks, filters]);
  const hasChips = Boolean(filters.team) || filters.splits.length > 0;

  // Any new filter starts the list again from its newest rows.
  const update = (change: Partial<SettledFilters>) => {
    setFilters((current) => ({ ...current, ...change }));
    setShown(SETTLED_PAGE);
  };

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-strong pb-3">
        <h2 className="type-module">Settled</h2>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Segments
            label="Range"
            options={RANGES}
            value={filters.range}
            onChange={(range) => update({ range })}
          />
          <Segments
            label="Result"
            options={RESULTS}
            value={filters.result}
            onChange={(result) => update({ result })}
          />
          <label className="flex items-center gap-2 text-sm text-ink-2">
            Show model
            <Switch
              checked={showModel}
              label="Show model"
              onChange={() => setShowModel((current) => !current)}
            />
          </label>
          <select
            aria-label="Team"
            className={cn("field px-1.5", filters.team && "field-query")}
            value={filters.team}
            onChange={(event) => update({ team: event.target.value })}
          >
            <option value="">All teams</option>
            {teams.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-strong py-3">
        <SettledSummary picks={rows} />
        <div className="flex flex-wrap items-center gap-3">
          {filters.team ? (
            <FilterChip label={filters.team} onRemove={() => update({ team: "" })} />
          ) : null}
          {filters.splits.map((id) => (
            <FilterChip
              key={id}
              label={splitLabel(id)}
              onRemove={() => update({ splits: toggleSplit(filters.splits, id) })}
            />
          ))}
          {hasChips ? (
            <button
              type="button"
              className="text-sm text-primary"
              onClick={() => update({ team: "", splits: [] })}
            >
              Clear all
            </button>
          ) : null}
          <Breakdown
            picks={picks}
            filters={filters}
            onToggle={(id) => update({ splits: toggleSplit(filters.splits, id) })}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="type-caption py-3">No picks match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-20">Date</th>
                <th className="w-12">
                  <span className="sr-only">Result</span>
                </th>
                <th>Pick</th>
                <th className="w-36">Final</th>
                {showModel ? <th className="w-20">Model</th> : null}
                <th className="w-28 text-right max-sm:hidden">Stake</th>
                <th className="w-24 pr-0 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((pick) => (
                <SettledRow key={pick.game_id} pick={pick} showModel={showModel} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown ? (
        <button
          type="button"
          className="field mt-4 px-5"
          onClick={() => setShown((current) => current + SETTLED_PAGE)}
        >
          Show {Math.min(SETTLED_PAGE, rows.length - shown)} more
        </button>
      ) : null}
      <p className="type-caption mt-4">
        Breakdown splits filter the list. Click a row to open the game.
      </p>
    </section>
  );
}
