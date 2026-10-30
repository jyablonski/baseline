"use client";

import { useActionState, useState } from "react";

import { promoteModelAction, remindModelAction, type JobActionState } from "@/app/admin/actions";
import { Section } from "@/components/admin/section";
import { KpiCard, KpiStrip, KpiTitle } from "@/components/ui/kpi-card";
import { Switch } from "@/components/ui/switch";
import { formatNumber, formatProbability, formatShortDate, formatShortDateET } from "@/lib/format";
import {
  PROMOTION_GAMES,
  type CalibrationPoint,
  type LogRow,
  type ModelReviewView,
  type ReviewedModel,
  type ShadowLead,
} from "@/lib/model-review";
import { cn } from "@/lib/utils";

const LOG_PAGE = 10;

/** The lowest, or the highest, of a column: drawn bold. Null when nothing stands out. */
function bestOf(
  models: ReviewedModel[],
  value: (model: ReviewedModel) => number | null | undefined,
  pick: typeof Math.min
) {
  const values = models.map(value).filter((item) => item != null);
  return new Set(values).size > 1 ? pick(...values) : null;
}

export function ModelsPanel({ view, showLead }: { view: ModelReviewView; showLead: boolean }) {
  const [selected, setSelected] = useState(view.live?.row.model_version ?? null);
  const [state, formAction] = useActionState<JobActionState, FormData>(promoteModelAction, null);

  if (view.models.length === 0) {
    return (
      <p className="pt-10 text-sm text-muted-foreground">
        No graded predictions yet. Models appear here once their games are final.
      </p>
    );
  }
  const chosen =
    view.models.find((model) => model.row.model_version === selected) ?? view.models[0];

  return (
    <div className="space-y-10">
      <Kpis view={view} />
      {view.lead && showLead ? <LeadBanner lead={view.lead} /> : null}
      {view.staleServing ? (
        <p className="border border-rule bg-tint px-4 py-3 text-sm text-ink-2">
          The schedule still shows {view.staleServing} until gold is rebuilt.
        </p>
      ) : null}

      <Section
        title={`All models${view.season ? ` · ${view.season}` : ""}`}
        note="Best per column in bold · log loss and Brier: lower is better"
      >
        <ModelTable
          view={view}
          selected={chosen.row.model_version}
          onSelect={setSelected}
          formAction={formAction}
        />
        {state ? (
          <p
            role="status"
            className={
              state.ok
                ? "text-xs text-muted-foreground"
                : "bg-destructive/10 px-3 py-2 text-xs text-destructive"
            }
          >
            {state.message}
          </p>
        ) : null}
        <p className="type-caption">
          Sparkline: rolling 30-game log loss, lower is better. {view.lateNote}
        </p>
      </Section>

      <div className="grid gap-x-14 gap-y-10 lg:grid-cols-[2fr_3fr]">
        <Section title={`Calibration · ${chosen.label}`} note="predicted vs actual">
          <CalibrationChart points={chosen.calibration} />
          <p className="type-caption">Dot size is the number of games in each bucket.</p>
        </Section>
        <PredictionLog view={view} />
      </div>
    </div>
  );
}

function Kpis({ view }: { view: ModelReviewView }) {
  const { live, bestShadow, liveSince } = view;
  const row = live?.row;
  return (
    <KpiStrip className="border-x border-t-0 border-rule border-b-rule">
      <KpiCard
        label="Live model"
        value={<KpiTitle>{live?.label ?? "—"}</KpiTitle>}
        note={
          row
            ? `on Schedule${liveSince ? ` since ${formatShortDateET(liveSince)}` : ""} · ${row.n} games`
            : "no graded games yet"
        }
      />
      <KpiCard
        label="Live log loss"
        value={formatNumber(row?.logloss, 3)}
        note={
          row?.market_logloss != null
            ? `market ${formatNumber(row.market_logloss, 3)} · lower is better`
            : "lower is better"
        }
      />
      <KpiCard
        label="Live accuracy"
        value={formatProbability(row?.accuracy)}
        note={
          row?.accuracy != null
            ? `${Math.round(row.accuracy * row.n)} of ${row.n} winners · home team ${formatProbability(row.home_always_accuracy)}`
            : undefined
        }
      />
      <KpiCard
        label="Best shadow"
        value={<KpiTitle>{bestShadow?.label ?? "—"}</KpiTitle>}
        note={
          bestShadow
            ? `${formatNumber(bestShadow.row.logloss, 3)} log loss over ${bestShadow.row.n} games`
            : "no shadow models graded"
        }
      />
    </KpiStrip>
  );
}

function LeadBanner({ lead }: { lead: ShadowLead }) {
  const noise = `±${lead.noise.toFixed(2)}`;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-4 border border-warn/30 bg-warn/10 px-5 py-4"
      data-testid="shadow-lead"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold">
          {lead.label} is ahead of live on log loss
          {lead.betterCalibrated ? " and calibration" : ""}
        </p>
        <p className="text-sm text-ink-2">
          {lead.shadow.toFixed(3)} vs {lead.live.toFixed(3)} over the {lead.n} games both predicted.{" "}
          {lead.clear
            ? `The gap is past normal noise at this sample size (${noise}).`
            : lead.ready
              ? `The gap is still inside normal noise (${noise}).`
              : `The gap is inside normal noise at this sample size (${noise}); wait for about ${PROMOTION_GAMES} games before promoting.`}
        </p>
      </div>
      {lead.ready ? null : (
        <form action={remindModelAction}>
          <input type="hidden" name="model_version" value={lead.modelVersion} />
          <button type="submit" className="field px-4">
            Remind me at {PROMOTION_GAMES}
          </button>
        </form>
      )}
    </div>
  );
}

function ModelTable({
  view,
  selected,
  onSelect,
  formAction,
}: {
  view: ModelReviewView;
  selected: string;
  onSelect: (version: string) => void;
  formAction: (formData: FormData) => void;
}) {
  const { models } = view;
  const baseline = models[0].row;
  const best = {
    logloss: bestOf(models, (model) => model.row.logloss, Math.min),
    brier: bestOf(models, (model) => model.row.brier, Math.min),
    accuracy: bestOf(models, (model) => model.row.accuracy, Math.max),
    calibration: bestOf(models, (model) => model.row.calibration_error, Math.min),
  };
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Status</th>
            <th className="text-right">Games</th>
            <th className="text-right">Log loss</th>
            <th className="text-right">Brier</th>
            <th className="text-right">Accuracy</th>
            <th className="text-right">Calib. error</th>
            <th>Last 30 games</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const { row } = model;
            return (
              <tr
                key={row.model_version}
                data-testid={`model-${row.model_version}`}
                className={cn(model.live && "bg-tint")}
              >
                <td>
                  <button
                    type="button"
                    aria-pressed={row.model_version === selected}
                    onClick={() => onSelect(row.model_version)}
                    className={cn(
                      "text-left hover:text-primary",
                      row.model_version === selected && "font-semibold"
                    )}
                  >
                    {model.label}
                  </button>
                  {model.note ? <span className="type-caption block">{model.note}</span> : null}
                </td>
                <td>
                  {model.live ? (
                    <span className="bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                      Live
                    </span>
                  ) : (
                    <span className="border border-rule-strong bg-field px-2 py-0.5 text-xs font-semibold">
                      Shadow
                    </span>
                  )}
                </td>
                <td className="tabular text-right text-ink-2">{formatNumber(row.n)}</td>
                <Metric value={row.logloss} best={best.logloss} digits={3} />
                <Metric value={row.brier} best={best.brier} digits={3} />
                <td
                  className={cn(
                    "tabular text-right",
                    row.accuracy != null && row.accuracy === best.accuracy && "font-semibold"
                  )}
                >
                  {formatProbability(row.accuracy)}
                </td>
                <Metric value={row.calibration_error} best={best.calibration} digits={3} />
                <td>
                  <Sparkline points={model.sparkline} live={model.live} />
                </td>
                <td className="text-right whitespace-nowrap">
                  {model.live ? (
                    <span className="text-sm text-ink-3">on Schedule</span>
                  ) : (
                    <PromoteButton model={model} formAction={formAction} />
                  )}
                </td>
              </tr>
            );
          })}
          <tr className="text-ink-2">
            <td>
              Sportsbook market
              <span className="type-caption block">
                Sportsbook odds with their built-in fee removed
              </span>
            </td>
            <td />
            <td className="tabular text-right">{formatNumber(baseline.market_n)}</td>
            <td className="tabular text-right">{formatNumber(baseline.market_logloss, 3)}</td>
            <td className="tabular text-right">{formatNumber(baseline.market_brier, 3)}</td>
            <td className="tabular text-right">—</td>
            <td className="tabular text-right">—</td>
            <td>
              <Sparkline points={view.marketSparkline} />
            </td>
            <td />
          </tr>
          <tr className="text-ink-2">
            <td>
              Always pick home
              <span className="type-caption block">baseline</span>
            </td>
            <td />
            <td className="tabular text-right">{formatNumber(baseline.n)}</td>
            <td className="tabular text-right">—</td>
            <td className="tabular text-right">—</td>
            <td className="tabular text-right">
              {formatProbability(baseline.home_always_accuracy)}
            </td>
            <td className="tabular text-right">—</td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Metric({
  value,
  best,
  digits,
}: {
  value: number | null | undefined;
  best: number | null;
  digits: number;
}) {
  return (
    <td className={cn("tabular text-right", value != null && value === best && "font-semibold")}>
      {formatNumber(value, digits)}
    </td>
  );
}

/** Two steps: this changes what every visitor sees. */
function PromoteButton({
  model,
  formAction,
}: {
  model: ReviewedModel;
  formAction: (formData: FormData) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="btn-ghost" onClick={() => setConfirming(true)}>
        Promote to live
      </button>
    );
  }
  return (
    <form action={formAction} className="inline-flex items-center gap-3">
      <input type="hidden" name="model_version" value={model.row.model_version} />
      <button
        type="button"
        className="text-sm text-ink-2 hover:text-foreground"
        onClick={() => setConfirming(false)}
      >
        Cancel
      </button>
      <button type="submit" className="btn-fill">
        Make {model.label} live
      </button>
    </form>
  );
}

function Sparkline({ points, live = false }: { points: number[]; live?: boolean }) {
  if (points.length < 2) return <span className="text-ink-3">—</span>;
  const width = 130;
  const height = 24;
  const low = Math.min(...points);
  const span = Math.max(...points) - low || 1;
  const line = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = 2 + (1 - (point - low) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} aria-hidden="true" className="block">
      <polyline
        points={line}
        fill="none"
        strokeWidth="1.5"
        stroke={live ? "var(--ct-accent)" : "var(--ct-ink-3)"}
      />
    </svg>
  );
}

function CalibrationChart({ points }: { points: CalibrationPoint[] }) {
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No graded games yet.</p>;
  }
  const left = 40;
  const top = 8;
  const size = 280;
  const x = (share: number) => left + share * size * 1.4;
  const y = (share: number) => top + (1 - share) * size;
  const most = Math.max(...points.map((point) => point.n));
  return (
    <svg
      viewBox={`0 0 ${left + size * 1.4 + 4} ${size + 36}`}
      role="img"
      aria-label="Predicted win chance against how often those teams won"
      className="w-full"
    >
      <rect
        x={x(0)}
        y={y(1)}
        width={size * 1.4}
        height={size}
        fill="var(--ct-raised)"
        stroke="var(--ct-rule)"
      />
      <line
        x1={x(0)}
        y1={y(0)}
        x2={x(1)}
        y2={y(1)}
        stroke="var(--ct-ink-3)"
        strokeDasharray="4 4"
      />
      {[0, 0.5, 1].map((tick) => (
        <text
          key={tick}
          x={left - 8}
          y={y(tick) + 4}
          textAnchor="end"
          className="fill-ink-3 text-[11px]"
        >
          {tick * 100}%
        </text>
      ))}
      <text x={x(0)} y={size + 28} className="fill-ink-3 text-[11px]">
        0%
      </text>
      <text x={x(0.5)} y={size + 28} textAnchor="middle" className="fill-ink-3 text-[11px]">
        Predicted win chance
      </text>
      <text x={x(1)} y={size + 28} textAnchor="end" className="fill-ink-3 text-[11px]">
        100%
      </text>
      <polyline
        points={points.map((point) => `${x(point.predicted)},${y(point.actual)}`).join(" ")}
        fill="none"
        stroke="var(--ct-accent)"
        strokeWidth="2"
      />
      {points.map((point) => (
        <circle
          key={point.predicted}
          cx={x(point.predicted)}
          cy={y(point.actual)}
          r={5 + 6 * Math.sqrt(point.n / most)}
          fill="var(--ct-accent)"
        >
          <title>
            {`Said ${Math.round(point.predicted * 100)}%, won ${Math.round(point.actual * 100)}% of ${point.n} games`}
          </title>
        </circle>
      ))}
    </svg>
  );
}

function CallCell({ wp, homeWon }: { wp: number | null | undefined; homeWon: boolean }) {
  if (wp == null) return <td className="tabular text-right text-ink-3">—</td>;
  return (
    <td
      className={cn(
        "tabular text-right",
        wp >= 0.5 === homeWon ? "text-primary" : "text-destructive"
      )}
    >
      {Math.round(wp * 100)}%
    </td>
  );
}

function PredictionLog({ view }: { view: ModelReviewView }) {
  const [onlyDisagreements, setOnlyDisagreements] = useState(false);
  const [shown, setShown] = useState(LOG_PAGE);
  const rows = onlyDisagreements ? view.log.filter((row) => row.disagree) : view.log;
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-rule-strong pb-2">
        <h2 className="type-module">Prediction log</h2>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          Disagreements only
          <Switch
            checked={onlyDisagreements}
            label="Disagreements only"
            onChange={() => {
              setOnlyDisagreements((current) => !current);
              setShown(LOG_PAGE);
            }}
          />
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every model agreed on these games.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Game · home win %</th>
                {view.logColumns.map((column) => (
                  <th key={column.version} className="text-right">
                    {column.label}
                  </th>
                ))}
                <th className="text-right">Market</th>
                <th className="text-right">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((row) => (
                <LogLine key={row.gameId} row={row} view={view} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown ? (
        <button
          type="button"
          className="field px-4"
          onClick={() => setShown((current) => current + 20)}
        >
          Show {Math.min(20, rows.length - shown)} more
        </button>
      ) : null}
      <p className="type-caption">
        Green: picked the winner (over 50% on the winning side). Red: wrong side.
      </p>
    </section>
  );
}

function LogLine({ row, view }: { row: LogRow; view: ModelReviewView }) {
  return (
    <tr data-testid="prediction-log-row">
      <td className="whitespace-nowrap text-ink-2">{formatShortDate(row.date)}</td>
      <td className="whitespace-nowrap">{row.matchup}</td>
      {view.logColumns.map((column) => (
        <CallCell key={column.version} wp={row.calls[column.version]} homeWon={row.homeWon} />
      ))}
      <CallCell wp={row.marketWp} homeWon={row.homeWon} />
      <td className="text-right font-semibold whitespace-nowrap">{row.winner} won</td>
    </tr>
  );
}
