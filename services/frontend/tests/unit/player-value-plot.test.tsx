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
  return { ...point, labelled: false, dimmed: false, ...overrides };
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
    expect(screen.getByText(/MVP score is a proprietary Baseline metric/)).toBeInTheDocument();
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
    expect(screen.queryByText(/Each dot is a player/)).not.toBeInTheDocument();
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

  it("draws a dot that links to the player, named only when labelled", () => {
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
    expect(container.querySelector("text")).toHaveTextContent("Jackson Jr.");
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

  it("shows the player, score, pay, and group in the tooltip", () => {
    const { container, rerender } = render(
      <PlayerValueTooltip active payload={[{ payload: plotted() }]} />
    );
    expect(container).toHaveTextContent("Jaren Jackson Jr. · MEM");
    expect(container).toHaveTextContent("MVP 20.0 (#40) · $30M");
    expect(container).toHaveTextContent("Average · 60 games");

    rerender(
      <PlayerValueTooltip active payload={[{ payload: plotted({ team_abbreviation: null }) }]} />
    );
    expect(container).not.toHaveTextContent("·  ·");
    expect(container).toHaveTextContent("Jaren Jackson Jr.MVP");

    rerender(<PlayerValueTooltip active={false} payload={[{ payload: plotted() }]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PlayerValueTooltip active payload={[{}]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
