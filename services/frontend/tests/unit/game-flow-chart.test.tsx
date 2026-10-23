import { render, screen, within } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

const CHART_WIDTH = 800;
const CHART_HEIGHT = 460;

// jsdom has no layout, so give the chart a fixed size instead of measuring its
// container; recharts then draws the full SVG and the overlay can be asserted on.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: CHART_WIDTH, height: CHART_HEIGHT }),
  };
});

import {
  type ChartPoint,
  flowChartModel,
  GameFlowChart,
  GameFlowTooltip,
  type RunMark,
} from "@/components/charts/game-flow-chart";
import { selectBiggestRun } from "@/lib/game-flow";
import { resolvePlotColors } from "@/lib/team-colors";
import type { GameFlow, PlayByPlayEvent } from "@/lib/types";

const FLOW: GameFlow = {
  game_id: "0022500001",
  season: "2025-26",
  game_date: "2026-10-21",
  home_team_id: "00000000-0000-4000-8000-000000000201",
  away_team_id: "00000000-0000-4000-8000-000000000202",
  home_team_abbreviation: "DAL",
  away_team_abbreviation: "IND",
  home_primary_color: "#00538C",
  home_alternate_color: "#B8C4CA",
  away_primary_color: "#FDBB30",
  away_alternate_color: "#002D62",
  has_play_by_play: true,
};

const COLORS = resolvePlotColors({
  homePrimary: FLOW.home_primary_color,
  homeAlternate: FLOW.home_alternate_color,
  awayPrimary: FLOW.away_primary_color,
  awayAlternate: FLOW.away_alternate_color,
});

type Play = { t: number; home?: number; away?: number; period?: number; clock?: string | null };

/** Scoring plays from per-play points; the clock is derived from `t` unless given. */
function plays(list: Play[]): PlayByPlayEvent[] {
  let scoreHome = 0;
  let scoreAway = 0;
  return list.map((play, index) => {
    scoreHome += play.home ?? 0;
    scoreAway += play.away ?? 0;
    const period = play.period ?? (play.t < 720 ? 1 : Math.floor(play.t / 720) + 1);
    const remaining = period * 720 - play.t;
    const clock =
      play.clock !== undefined
        ? play.clock
        : `PT${Math.floor(remaining / 60)}M${String(remaining % 60).padStart(2, "0")}.00S`;
    return {
      game_id: FLOW.game_id,
      action_number: index + 1,
      period,
      clock,
      elapsed_seconds: play.t,
      score_home: scoreHome,
      score_away: scoreAway,
      score_differential: scoreHome - scoreAway,
      scoring_side: (play.home ?? 0) > 0 ? "home" : (play.away ?? 0) > 0 ? "away" : null,
      description: `Play ${index + 1}`,
    };
  });
}

// DAL climbs to +4, then IND answers 17–4 to lead by 9, then the game settles.
const SWING_GAME = plays([
  { t: 30, home: 2 },
  { t: 60, away: 2 },
  { t: 90, home: 2 },
  { t: 116, home: 2 }, // DAL +4 at 10:04, where the run starts from
  { t: 140, away: 3 },
  { t: 170, home: 2 },
  { t: 200, away: 2 },
  { t: 240, away: 2 },
  { t: 280, home: 2 },
  { t: 300, away: 3 },
  { t: 315, away: 2 },
  { t: 330, away: 3 },
  { t: 343, away: 2 }, // IND +9 at 6:17, where it ends
  { t: 500, home: 2 },
  { t: 560, away: 2 },
  { t: 640, home: 3 },
]);

function model(events: PlayByPlayEvent[], flow: GameFlow = FLOW) {
  const result = flowChartModel(events, flow);
  if (!result) throw new Error("expected a chart model");
  return result;
}

function expectRun(run: RunMark | null): RunMark {
  if (!run) throw new Error("expected a run");
  return run;
}

describe("flowChartModel", () => {
  it("has nothing to plot without play-by-play", () => {
    expect(flowChartModel([], FLOW)).toBeNull();
  });

  it("finds the swing run and marks exactly its stretch of the line", () => {
    const { points, run } = model(SWING_GAME);
    const mark = expectRun(run);

    expect(mark.title).toBe("IND 17–4 run");
    expect(mark.detail).toBe("Q1 10:04–6:17 · 13-pt swing");
    expect(mark.anchor).toMatchObject({ elapsed_seconds: 116, score_differential: 4 });
    expect(mark.last).toMatchObject({ elapsed_seconds: 343, score_differential: -9 });
    expect(mark.plays.map((play) => play.elapsed_seconds)).toEqual([
      140, 170, 200, 240, 280, 300, 315, 330, 343,
    ]);

    // A synthetic tip-off point opens the line, so indices are shifted by one.
    expect(points[0]).toMatchObject({ elapsed_seconds: 0, description: "Tip-off" });
    expect(points).toHaveLength(SWING_GAME.length + 1);

    const runLine = points.filter((point) => point.run_differential != null);
    expect(runLine.map((point) => point.elapsed_seconds)).toEqual([
      116, 140, 170, 200, 240, 280, 300, 315, 330, 343,
    ]);
    for (const point of runLine) expect(point.run_differential).toBe(point.score_differential);
    // The point the run starts from is on its line but is not one of its plays.
    expect(points.filter((point) => point.in_run)).toEqual(mark.plays);
    expect(mark.anchor.in_run).toBe(false);
  });

  it("colours an away run in the away colour and draws it falling", () => {
    const mark = expectRun(model(SWING_GAME).run);
    expect(mark.color).toBe(COLORS.away);
    expect(mark.rising).toBe(false);
  });

  it("colours a home run in the home colour and draws it rising", () => {
    const mark = expectRun(
      model(
        plays([
          { t: 20, away: 3 },
          { t: 50, home: 2 },
          { t: 80, home: 3 },
          { t: 110, home: 2 },
          { t: 140, away: 2 },
        ])
      ).run
    );
    expect(mark.title).toBe("DAL 7–0 run");
    expect(mark.color).toBe(COLORS.home);
    expect(mark.rising).toBe(true);
    expect(mark.anchor).toMatchObject({ elapsed_seconds: 20, score_differential: -3 });
  });

  it("starts a run from tip-off when it opens the game", () => {
    const { points, run } = model(
      plays([
        { t: 15, away: 3 },
        { t: 40, away: 2 },
        { t: 70, home: 2 },
        { t: 100, away: 2 },
        { t: 130, home: 2 },
        { t: 160, home: 2 },
      ])
    );
    const mark = expectRun(run);
    expect(mark.anchor).toBe(points[0]);
    expect(mark.anchor.description).toBe("Tip-off");
    expect(mark.detail).toMatch(/^Q1 12:00–/);
    expect(mark.plays[0].elapsed_seconds).toBe(15);
  });

  it("does not add a tip-off point when the first event already sits at 0–0", () => {
    const events = plays([{ t: 0 }, { t: 20, home: 3 }, { t: 40, home: 2 }, { t: 60, away: 2 }]);
    const { points, run } = model(events);
    expect(points).toHaveLength(events.length);
    const mark = expectRun(run);
    expect(mark.anchor).toBe(points[0]);
    expect(mark.title).toBe("DAL 5–0 run");
  });

  it("splits two free throws at the same second on the play, not the time", () => {
    // DAL's free throw and IND's free throw share a timestamp; IND's 10–0 run
    // starts from DAL's, so a time-based cut would wrongly pull it into the run.
    const { points, run } = model(
      plays([
        { t: 50, home: 2 },
        { t: 100, home: 1 },
        { t: 100, away: 1 },
        { t: 120, away: 3 },
        { t: 140, away: 3 },
        { t: 160, away: 3 },
        { t: 300, home: 2 },
        { t: 330, away: 1 },
        { t: 360, home: 2 },
      ])
    );
    const mark = expectRun(run);
    expect(mark.title).toBe("IND 10–0 run");
    expect(mark.anchor).toMatchObject({ elapsed_seconds: 100, score_home: 3, score_away: 0 });
    expect(mark.plays[0]).toMatchObject({ elapsed_seconds: 100, score_home: 3, score_away: 1 });
    expect(mark.anchor.in_run).toBe(false);
    expect(points.filter((point) => point.elapsed_seconds === 100).map((p) => p.in_run)).toEqual([
      false,
      true,
    ]);
  });

  it("names both quarters when a run crosses one", () => {
    const mark = expectRun(
      model(
        plays([
          { t: 600, home: 2 },
          { t: 690, away: 3 },
          { t: 710, away: 2 },
          { t: 740, away: 3 },
          { t: 760, away: 2 },
          { t: 900, home: 2 },
        ])
      ).run
    );
    expect(mark.detail).toBe("Q1 2:00–Q2 11:20 · 10-pt swing");
  });

  it("says only the quarter when the play-by-play has no clocks", () => {
    const mark = expectRun(
      model(
        plays([
          { t: 30, home: 2, clock: null },
          { t: 60, away: 3, clock: null },
          { t: 90, away: 3, clock: null },
          { t: 120, home: 1, clock: null },
        ])
      ).run
    );
    expect(mark.detail).toBe("Q1 · 6-pt swing");
  });

  it("has no run when nobody scored", () => {
    const { points, run } = model(plays([{ t: 0 }, { t: 30 }]));
    expect(run).toBeNull();
    expect(points.every((point) => point.in_run === undefined)).toBe(true);
  });

  it("keeps the y-axis symmetric in steps of 5, or 10 in a blowout", () => {
    const close = model(SWING_GAME);
    expect(close.yMax).toBe(10);
    expect(close.yTicks).toEqual([-10, -5, 0, 5, 10]);
    expect(close.yDomain[0]).toBeLessThan(-10);
    expect(close.yDomain[1]).toBeGreaterThan(10);
    expect(close.yDomain[0]).toBe(-close.yDomain[1]);

    const blowout = model(
      plays([
        { t: 100, home: 21 },
        { t: 200, away: 2 },
      ])
    );
    expect(blowout.yMax).toBe(30);
    expect(blowout.yTicks).toEqual([-30, -20, -10, 0, 10, 20, 30]);

    const scoreless = model(plays([{ t: 0 }]));
    expect(scoreless.yMax).toBe(5);
  });

  it("adds an overtime tick only when the game went past regulation", () => {
    expect(model(SWING_GAME).ticks.map((tick) => tick.label)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(
      model(SWING_GAME, { ...FLOW, game_elapsed_seconds: 3180 }).ticks.map((tick) => tick.label)
    ).toEqual(["Q1", "Q2", "Q3", "Q4", "OT1"]);
  });

  it("falls back to Home and Away without abbreviations", () => {
    const result = model(SWING_GAME, {
      ...FLOW,
      home_team_abbreviation: null,
      away_team_abbreviation: null,
    });
    expect(result.home).toBe("Home");
    expect(result.away).toBe("Away");
    expect(expectRun(result.run).title).toBe("Away 17–4 run");
  });
});

function svgTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll("svg text")].map((text) => text.textContent ?? "");
}

describe("GameFlowChart", () => {
  it("shows the empty state without play-by-play", () => {
    render(<GameFlowChart events={[]} flow={FLOW} />);
    expect(screen.getByText("No PBP data available.")).toBeInTheDocument();
  });

  it("labels each side's dots in its colour, away first", () => {
    render(<GameFlowChart events={SWING_GAME} flow={FLOW} />);
    const legend = screen.getByTestId("flow-legend");
    expect(legend).toHaveTextContent(/^IND scores\s*DAL scores$/);
    const swatches = legend.querySelectorAll("[aria-hidden]");
    expect(swatches[0]).toHaveStyle({ background: COLORS.away });
    expect(swatches[1]).toHaveStyle({ background: COLORS.home });
  });

  it("reads the y-axis as a lead for either side", () => {
    const { container } = render(<GameFlowChart events={SWING_GAME} flow={FLOW} />);
    const texts = svgTexts(container);
    expect(texts).toEqual(expect.arrayContaining(["DAL ahead", "IND ahead"]));
    const yTicks = [...container.querySelectorAll(".recharts-yAxis-tick-labels text")];
    expect(yTicks.map((tick) => tick.textContent)).toEqual(["+10", "+5", "0", "+5", "+10"]);
    // No negative leads anywhere on the axis.
    expect(texts.some((text) => /^[-−]\d/.test(text))).toBe(false);
  });

  it("draws the run on the line, rings its ends and labels the leads there", () => {
    const { container } = render(<GameFlowChart events={SWING_GAME} flow={FLOW} />);
    const lines = container.querySelectorAll(".recharts-line-curve");
    expect(lines).toHaveLength(2);
    const runLine = [...lines].find((line) => line.getAttribute("stroke") === COLORS.away);
    expect(runLine).toBeDefined();
    expect(runLine?.getAttribute("stroke-width")).toBe("3.5");

    expect(container.querySelectorAll(".recharts-reference-dot")).toHaveLength(2);
    expect(svgTexts(container)).toEqual(expect.arrayContaining(["DAL +4", "IND +9"]));
  });

  it("brackets the run under the time axis with its label in its own lane", () => {
    const { container } = render(<GameFlowChart events={SWING_GAME} flow={FLOW} />);
    const marks = screen.getByTestId("run-marks");
    expect(marks).toHaveTextContent("IND 17–4 run · Q1 10:04–6:17 · 13-pt swing");
    // The title is set apart from the detail.
    expect(within(marks).getByText("IND 17–4 run").tagName.toLowerCase()).toBe("tspan");
    expect(within(marks).getByText("IND 17–4 run")).toHaveAttribute("font-weight", "600");

    const bracket = marks.querySelector("path");
    expect(bracket).toHaveAttribute("stroke", COLORS.away);
    const guides = marks.querySelectorAll("line");
    expect(guides).toHaveLength(2);
    for (const guide of guides) expect(guide).toHaveAttribute("stroke-dasharray", "3 3");

    // The bracket and label sit below the time axis line, not on the plot.
    const axisLine = container.querySelector(".recharts-xAxis .recharts-cartesian-axis-line");
    const axisY = Number(axisLine?.getAttribute("y1"));
    const bracketTop = Math.min(
      ...(bracket?.getAttribute("d")?.match(/V([\d.]+)/g) ?? []).map((v) => Number(v.slice(1)))
    );
    expect(bracketTop).toBeGreaterThan(axisY);
    const label = marks.querySelector("text");
    expect(Number(label?.getAttribute("y"))).toBeGreaterThan(bracketTop);
    expect(Number(label?.getAttribute("y"))).toBeLessThanOrEqual(CHART_HEIGHT);

    // The guides drop from each ring down to the axis.
    for (const guide of guides) expect(Number(guide.getAttribute("y2"))).toBe(axisY);
  });

  it("keeps the run label inside the chart when the run ends the game", () => {
    const lateRun = plays([
      { t: 300, home: 2 },
      { t: 1500, away: 2 },
      { t: 2800, away: 2 },
      { t: 2820, home: 3 },
      { t: 2840, home: 3 },
      { t: 2860, home: 3 },
      { t: 2875, home: 2 },
    ]);
    render(<GameFlowChart events={lateRun} flow={FLOW} />);
    // Centred under the bracket, this label would run well past the right edge.
    expect(screen.getByTestId("run-marks")).toHaveTextContent("DAL 11–0 run · Q4 1:20–0:05");
    const label = screen.getByTestId("run-marks").querySelector("text");
    const x = Number(label?.getAttribute("x"));
    const halfWidth = ((label?.textContent?.length ?? 0) * 7) / 2;
    expect(x + halfWidth).toBeLessThanOrEqual(CHART_WIDTH);
    expect(x - halfWidth).toBeGreaterThanOrEqual(0);
  });

  it("draws the run the page hands it rather than picking its own", () => {
    const { container, unmount } = render(
      <GameFlowChart events={SWING_GAME} flow={FLOW} run={null} />
    );
    expect(screen.queryByTestId("run-marks")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-reference-dot")).toHaveLength(0);
    unmount();

    const picked = selectBiggestRun(SWING_GAME, {
      homeAbbreviation: FLOW.home_team_abbreviation,
      awayAbbreviation: FLOW.away_team_abbreviation,
    });
    render(<GameFlowChart events={SWING_GAME} flow={FLOW} run={picked} />);
    expect(screen.getByTestId("run-marks")).toHaveTextContent("IND 17–4 run");
  });

  it("makes room for the run lane only when there is a run", () => {
    const { container, unmount } = render(<GameFlowChart events={SWING_GAME} flow={FLOW} />);
    expect(container.querySelector(".h-\\[460px\\]")).not.toBeNull();
    unmount();

    const { container: quiet } = render(
      <GameFlowChart events={plays([{ t: 0 }, { t: 30 }])} flow={FLOW} />
    );
    expect(quiet.querySelector(".h-\\[420px\\]")).not.toBeNull();
    expect(screen.queryByTestId("run-marks")).not.toBeInTheDocument();
    expect(quiet.querySelectorAll(".recharts-reference-dot")).toHaveLength(0);
    expect(quiet.querySelectorAll(".recharts-line-curve")).toHaveLength(1);
    // The "ahead" labels do not depend on a run.
    expect(svgTexts(quiet)).toEqual(expect.arrayContaining(["DAL ahead", "IND ahead"]));
  });
});

describe("GameFlowTooltip run plays", () => {
  const { points, run } = model(SWING_GAME);
  const mark = expectRun(run);
  const tooltip = (point: ChartPoint, withRun: RunMark | null = mark) =>
    render(<GameFlowTooltip active payload={[{ payload: point }]} colors={COLORS} run={withRun} />);

  it("lists every play of the run when a run play is hovered, the hovered one in bold", () => {
    const hovered = mark.plays[3];
    tooltip({ ...hovered });
    const list = screen.getByTestId("run-plays");
    expect(list).toHaveTextContent("IND 17–4 run Q1 10:04–6:17 · 13-pt swing");
    const rows = within(list).getAllByText(/^Q1 · /);
    expect(rows).toHaveLength(mark.plays.length);
    rows.forEach((row, index) =>
      expect(row).toHaveStyle({ fontWeight: index === 3 ? "600" : "400" })
    );
    expect(rows[0]).toHaveTextContent("Q1 · 9:40 · Play 5 · IND 5–DAL 6");
    expect(rows.at(-1)).toHaveTextContent("Q1 · 6:17 · Play 13 · IND 19–DAL 10");
  });

  it("tints each run play by the side that scored", () => {
    tooltip({ ...mark.plays[0] });
    const swatches = screen.getByTestId("run-plays").querySelectorAll("[aria-hidden]");
    expect(swatches).toHaveLength(mark.plays.length);
    expect(swatches[0]).toHaveStyle({ background: COLORS.away });
    expect(swatches[1]).toHaveStyle({ background: COLORS.home });
  });

  it("leaves the run out for plays outside it, including where it starts from", () => {
    tooltip(mark.anchor);
    expect(screen.queryByTestId("run-plays")).not.toBeInTheDocument();
    tooltip(points.at(-1) as ChartPoint);
    expect(screen.queryByTestId("run-plays")).not.toBeInTheDocument();
  });

  it("shows the single play when there is no run", () => {
    tooltip({ ...mark.plays[0] }, null);
    expect(screen.queryByTestId("run-plays")).not.toBeInTheDocument();
    expect(screen.getByText("Play 5")).toBeInTheDocument();
  });
});
