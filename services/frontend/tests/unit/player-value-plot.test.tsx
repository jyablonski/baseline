import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const listPlayerValue = vi.fn();

vi.mock("@/lib/api", () => ({
  api: { listPlayerValue: (...args: unknown[]) => listPlayerValue(...args) },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import {
  PlayerDot,
  PlayerValueScatter,
  PlayerValueTooltip,
  type PlottedPlayer,
} from "@/components/charts/player-value-scatter";
import { PlayerValuePlot } from "@/components/players/value-plot";
import { Providers } from "@/components/providers";
import { playerValuePoints } from "@/lib/player-value";
import type { PlayerValue } from "@/lib/types";

function row(rank: number, name: string, team: string, score: number, salary: number): PlayerValue {
  return {
    player_id: `p${rank}`,
    full_name: name,
    team_abbreviation: team,
    mvp_season: "2025-26",
    mvp_score: score,
    mvp_rank: rank,
    games_played: 60,
    salary,
    salary_season: "2026-27",
  };
}

const ROWS = [
  row(1, "Nikola Jokić", "DEN", 38, 55_000_000),
  row(2, "Stephen Curry", "GSW", 30, 59_000_000),
  row(11, "Bargain Guard", "GSW", 24, 2_500_000),
  row(12, "Solid Wing", "LAL", 18, 20_000_000),
  row(13, "Role Player", "LAL", 12, 12_000_000),
  row(14, "Max Mistake", "DEN", 6, 48_000_000),
];

function page(data: PlayerValue[]) {
  return { data, meta: { total: data.length, limit: Math.max(data.length, 1), offset: 0 } };
}

function renderPlot(props: { season?: string; enabled?: boolean } = {}) {
  return render(
    <Providers>
      <PlayerValuePlot season={props.season ?? "2025-26"} enabled={props.enabled ?? true} />
    </Providers>
  );
}

function plotted(overrides: Partial<PlottedPlayer> = {}): PlottedPlayer {
  const [point] = playerValuePoints([row(40, "Jaren Jackson Jr.", "MEM", 20, 30_000_000)]);
  return { ...point, labelled: false, picked: false, dimmed: false, ...overrides };
}

describe("player value plot", () => {
  beforeEach(() => {
    listPlayerValue.mockReset();
    listPlayerValue.mockResolvedValue(page(ROWS));
  });

  it("explains the plot and counts each value group", async () => {
    renderPlot();

    expect(await screen.findByRole("heading", { name: "Production vs Salary" })).toBeVisible();
    expect(listPlayerValue).toHaveBeenCalledWith("2025-26");
    const legend = (label: string) => screen.getByText(label).closest("span") as HTMLElement;
    expect(within(legend("MVP candidate")).getByText("2")).toBeInTheDocument();
    expect(within(legend("Undervalued")).getByText("1")).toBeInTheDocument();
    expect(within(legend("Overpaid")).getByText("1")).toBeInTheDocument();
    expect(within(legend("Average")).getByText("2")).toBeInTheDocument();
    // Candidates are purple, apart from the green and red value groups.
    expect(legend("MVP candidate").querySelector("[aria-hidden]")).toHaveStyle({
      background: "#5B3A8C",
    });
    // Each legend entry says its rule in a few words.
    expect(legend("Undervalued").parentElement).toHaveTextContent("Score rank ≫ salary rank");
    // How MVP score works sits behind a disclosure, closed by default.
    const toggle = screen.getByRole("button", { name: /How it's scored/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("MVP score, in four steps")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("MVP score, in four steps")).toBeInTheDocument();
    expect(screen.getByText("Availability")).toBeInTheDocument();
    expect(
      screen.getByText("Top 10 in the league by MVP score, whatever they are paid.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Salary ranks at least 30 percentile points higher than MVP score.")
    ).toBeInTheDocument();
    expect(screen.getByText(/The league median is/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText("MVP score, in four steps")).not.toBeInTheDocument();
    // No caption under the plot: the legend and the labelled median lines say it.
    expect(screen.queryByText(/Undervalued and Overpaid mean/)).not.toBeInTheDocument();
    expect(screen.queryByText(/dashed lines mark/)).not.toBeInTheDocument();
    // A rule closes the plot off from the directory filters below it.
    expect(screen.getByRole("region", { name: "Production vs Salary" })).toHaveClass("border-b");
  });

  it("highlights one team or player at a time, replacing the last pick", async () => {
    renderPlot();
    const teamSelect = await screen.findByLabelText("Highlight a team");
    expect(screen.queryByRole("list", { name: "Highlighted" })).not.toBeInTheDocument();
    expect(teamSelect).toHaveDisplayValue("Highlight team…");
    expect(teamSelect).not.toHaveClass("field-query");

    fireEvent.change(teamSelect, { target: { value: "LAL" } });
    const chips = () => screen.getByRole("list", { name: "Highlighted" });
    expect(within(chips()).getByText("LAL")).toBeInTheDocument();
    // The control itself keeps showing the team that is picked.
    expect(teamSelect).toHaveDisplayValue("LAL");
    expect(teamSelect).toHaveClass("field-query");

    // Another team replaces it rather than adding to it.
    fireEvent.change(teamSelect, { target: { value: "GSW" } });
    expect(within(chips()).getByText("GSW")).toBeInTheDocument();
    expect(within(chips()).queryByText("LAL")).not.toBeInTheDocument();

    const playerInput = screen.getByLabelText("Highlight a player");
    fireEvent.change(playerInput, { target: { value: "bargain" } });
    // Not a full name yet: nothing changes, the text stays.
    expect(playerInput).toHaveValue("bargain");
    expect(within(chips()).getByText("GSW")).toBeInTheDocument();
    // A player replaces the team.
    fireEvent.change(playerInput, { target: { value: "bargain guard" } });
    expect(within(chips()).getByText("Bargain Guard")).toBeInTheDocument();
    expect(within(chips()).queryByText("GSW")).not.toBeInTheDocument();
    expect(playerInput).toHaveValue("");
    expect(teamSelect).toHaveDisplayValue("Highlight team…");

    // Typed without the accent, an accented name still matches.
    fireEvent.change(playerInput, { target: { value: "nikola jokic" } });
    expect(within(chips()).getByText("Nikola Jokić")).toBeInTheDocument();

    // And another player replaces that one.
    fireEvent.change(playerInput, { target: { value: "Solid Wing" } });
    expect(within(chips()).getByText("Solid Wing")).toBeInTheDocument();
    expect(within(chips()).queryByText("Nikola Jokić")).not.toBeInTheDocument();

    // A team replaces the player.
    fireEvent.change(teamSelect, { target: { value: "DEN" } });
    expect(within(chips()).getByText("DEN")).toBeInTheDocument();
    expect(within(chips()).queryByText("Solid Wing")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove DEN" }));
    expect(screen.queryByRole("list", { name: "Highlighted" })).not.toBeInTheDocument();

    fireEvent.change(playerInput, { target: { value: "Solid Wing" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Solid Wing" }));
    expect(screen.queryByRole("list", { name: "Highlighted" })).not.toBeInTheDocument();

    fireEvent.change(teamSelect, { target: { value: "DEN" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("list", { name: "Highlighted" })).not.toBeInTheDocument();
    // Choosing the blank option clears it too.
    fireEvent.change(teamSelect, { target: { value: "LAL" } });
    fireEvent.change(teamSelect, { target: { value: "" } });
    expect(screen.queryByRole("list", { name: "Highlighted" })).not.toBeInTheDocument();
  });

  it("asks for the latest scored season when none is selected", async () => {
    renderPlot({ season: "" });

    expect(await screen.findByRole("heading", { name: "Production vs Salary" })).toBeVisible();
    expect(listPlayerValue).toHaveBeenCalledWith(undefined);
    expect(screen.getByText(/Each dot is a player/)).toBeInTheDocument();
  });

  it("waits for the season, renders nothing without data, and reports a failure", async () => {
    const waiting = renderPlot({ enabled: false });
    expect(screen.getByRole("status", { name: "Loading value plot…" })).toBeInTheDocument();
    expect(listPlayerValue).not.toHaveBeenCalled();
    waiting.unmount();

    listPlayerValue.mockResolvedValue(page([]));
    const empty = renderPlot();
    await waitFor(() => expect(listPlayerValue).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Production vs Salary" })).toBeNull();
    empty.unmount();

    listPlayerValue.mockRejectedValue(new Error("Warehouse unavailable"));
    renderPlot();
    expect(
      await screen.findByText("Warehouse unavailable", {}, { timeout: 4000 })
    ).toBeInTheDocument();
  });
});

describe("player value scatter pieces", () => {
  it("renders nothing without points and a chart with them", () => {
    const { container: empty } = render(
      <PlayerValueScatter points={[]} teams={new Set()} players={new Set()} />
    );
    expect(empty).toBeEmptyDOMElement();

    const { container } = render(
      <PlayerValueScatter
        points={playerValuePoints(ROWS)}
        teams={new Set(["LAL"])}
        players={new Set()}
      />
    );
    expect(container.querySelector(".recharts-wrapper, svg, div")).toBeTruthy();
  });

  it("draws a dot that links to the player; names come from the chart's label layer", () => {
    const { container, rerender } = render(
      <svg>
        <PlayerDot cx={10} cy={20} payload={plotted()} />
      </svg>
    );
    expect(container.querySelector("a")).toHaveAttribute("href", "/players/jaren-jackson-jr");
    expect(container.querySelector("text")).toBeNull();
    // An unremarkable, unlabelled player sits back a little.
    expect(container.querySelector("circle")).toHaveAttribute("fill-opacity", "0.7");

    rerender(
      <svg>
        <PlayerDot cx={10} cy={20} payload={plotted({ labelled: true, category: "overpaid" })} />
      </svg>
    );
    expect(container.querySelector("text")).toBeNull();
    expect(container.querySelector("circle")).toHaveAttribute("fill", "#9B2C22");
    expect(container.querySelector("circle")).toHaveAttribute("fill-opacity", "1");

    rerender(
      <svg>
        <PlayerDot cx={10} cy={20} payload={plotted({ dimmed: true })} />
      </svg>
    );
    expect(container.querySelector("circle")).toHaveAttribute("fill-opacity", "0.18");

    rerender(
      <svg>
        <PlayerDot cx={10} payload={plotted()} />
      </svg>
    );
    expect(container.querySelector("circle")).toBeNull();
  });

  it("rings a picked player, bigger and bolder than a candidate named by default", () => {
    const { container, rerender } = render(
      <svg>
        <PlayerDot cx={10} cy={20} payload={plotted({ labelled: true, category: "mvp" })} />
      </svg>
    );
    // A default candidate label: named, but no ring and no dark outline.
    expect(screen.queryByTestId("pick-ring")).not.toBeInTheDocument();
    expect(container.querySelector("circle")).toHaveAttribute("r", "6");
    expect(container.querySelector("circle")).toHaveAttribute("stroke", "#FBFAF5");

    rerender(
      <svg>
        <PlayerDot
          cx={10}
          cy={20}
          payload={plotted({ labelled: true, picked: true, category: "mvp" })}
        />
      </svg>
    );
    const ring = screen.getByTestId("pick-ring");
    expect(ring).toHaveAttribute("r", "11");
    expect(ring).toHaveAttribute("stroke", "#1A1A1A");
    expect(ring).toHaveAttribute("fill", "none");
    const dot = container.querySelectorAll("circle")[1];
    expect(dot).toHaveAttribute("r", "7.5");
    expect(dot).toHaveAttribute("fill", "#5B3A8C");
  });

  it("names candidates by default and only the picks once something is picked", () => {
    const points = playerValuePoints(ROWS);
    const { rerender } = render(
      <PlayerValueScatter points={points} teams={new Set()} players={new Set()} />
    );
    const layer = () => screen.getByTestId("player-labels");
    const names = () => [...layer().querySelectorAll("text")].map((text) => text.textContent);
    expect(names().sort()).toEqual(["Curry", "Jokić"]);
    for (const text of layer().querySelectorAll("text")) {
      expect(text).toHaveAttribute("font-weight", "500");
      expect(text).toHaveAttribute("font-size", "12");
    }
    // The name links to the player too, but only the dot is announced and focusable.
    const nameLink = within(layer()).getByText("Jokić").closest("a");
    expect(nameLink?.getAttribute("href")).toBe(
      screen.getByRole("link", { name: "Nikola Jokić" }).getAttribute("href")
    );
    expect(nameLink).toHaveAttribute("aria-hidden", "true");
    expect(nameLink).toHaveAttribute("tabindex", "-1");

    rerender(<PlayerValueScatter points={points} teams={new Set()} players={new Set(["p13"])} />);
    expect(names()).toEqual(["Player"]);
    const picked = within(layer()).getByText("Player");
    expect(picked).toHaveAttribute("font-weight", "700");
    expect(picked).toHaveAttribute("font-size", "13");
  });

  it("pulls two candidates' names apart when their dots nearly touch", () => {
    const twins = playerValuePoints([
      row(1, "Shai Gilgeous-Alexander", "OKC", 34.2, 38_300_000),
      row(2, "Tyrese Maxey", "PHI", 34.0, 37_900_000),
      ...ROWS.slice(2),
    ]);
    render(<PlayerValueScatter points={twins} teams={new Set()} players={new Set()} />);
    const layer = screen.getByTestId("player-labels");
    const sga = within(layer).getByText("Gilgeous-Alexander");
    const maxey = within(layer).getByText("Maxey");
    // The higher rank keeps the spot beside its dot; the other takes another side or line.
    expect(sga).toHaveAttribute("text-anchor", "start");
    const sameLine = sga.getAttribute("y") === maxey.getAttribute("y");
    const sameSide = sga.getAttribute("text-anchor") === maxey.getAttribute("text-anchor");
    expect(sameLine && sameSide).toBe(false);
  });

  it("labels both median lines and keeps the grid solid", () => {
    const points = playerValuePoints(ROWS);
    const { container } = render(
      <PlayerValueScatter points={points} teams={new Set()} players={new Set()} />
    );
    const texts = [...container.querySelectorAll("svg text")].map((text) => text.textContent);
    // Salaries 2.5, 12, 20, 48, 55, 59 → median 34; scores 6…38 → median 21.
    expect(texts).toContain("Median salary $34M");
    expect(texts).toContain("Median MVP score 21.0");
    const references = container.querySelectorAll(".recharts-reference-line-line");
    expect(references).toHaveLength(2);
    for (const line of references) expect(line).toHaveAttribute("stroke-dasharray", "5 4");
    // Only the medians are dashed.
    for (const line of container.querySelectorAll(".recharts-cartesian-grid line")) {
      expect(line).not.toHaveAttribute("stroke-dasharray");
    }
  });

  it("rings only the picks, drawn after every other dot", () => {
    const points = playerValuePoints(ROWS);
    const { container, rerender } = render(
      <PlayerValueScatter points={points} teams={new Set()} players={new Set()} />
    );
    // Nobody picked: candidates are named, nobody is ringed.
    expect(screen.queryAllByTestId("pick-ring")).toHaveLength(0);

    rerender(<PlayerValueScatter points={points} teams={new Set(["DEN"])} players={new Set()} />);
    expect(screen.getAllByTestId("pick-ring")).toHaveLength(2);
    const names = [...container.querySelectorAll("a[aria-label]")].map((link) =>
      link.getAttribute("aria-label")
    );
    // Jokić (a candidate) and Max Mistake are DEN's two; they paint last.
    expect(names.slice(-2).sort()).toEqual(["Max Mistake", "Nikola Jokić"]);

    rerender(<PlayerValueScatter points={points} teams={new Set()} players={new Set(["p13"])} />);
    expect(screen.getAllByTestId("pick-ring")).toHaveLength(1);
    const last = [...container.querySelectorAll("a[aria-label]")].at(-1);
    expect(last).toHaveAttribute("aria-label", "Role Player");
  });

  it("shows the player, score, pay, and group in the tooltip", () => {
    const { container, rerender } = render(
      <PlayerValueTooltip active payload={[{ payload: plotted() }]} />
    );
    expect(container).toHaveTextContent("Jaren Jackson Jr. · MEM");
    expect(container).toHaveTextContent("MVP Score: 20.0 (#40) · $30M");
    expect(container).toHaveTextContent("Average · 60 games");
    // Average stays the muted line color; the other groups take their dot color.
    expect(screen.getByText("Average")).not.toHaveAttribute("style");

    rerender(
      <PlayerValueTooltip active payload={[{ payload: plotted({ category: "overpaid" }) }]} />
    );
    expect(screen.getByText("Overpaid")).toHaveStyle({ color: "#9B2C22" });

    rerender(
      <PlayerValueTooltip active payload={[{ payload: plotted({ team_abbreviation: null }) }]} />
    );
    expect(container).not.toHaveTextContent("·  ·");
    expect(container).toHaveTextContent("Jaren Jackson Jr.MVP Score:");

    rerender(<PlayerValueTooltip active={false} payload={[{ payload: plotted() }]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PlayerValueTooltip active payload={[{}]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
