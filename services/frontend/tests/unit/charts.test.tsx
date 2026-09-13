import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

import { GameFlowChart, GameFlowTooltip } from "@/components/charts/game-flow-chart";
import { FALLBACK_AWAY, FALLBACK_HOME } from "@/lib/team-colors";
import { SeasonLineChart } from "@/components/charts/season-line-chart";
import { StatBarChart } from "@/components/charts/stat-bar-chart";
import {
  QUADRANT_LABELS,
  RatingsTooltip,
  TeamLogoMarker,
  TeamRatingsScatter,
} from "@/components/charts/team-ratings-scatter";
import { WinLossDonut } from "@/components/charts/win-loss-donut";

const TEAM_A = "00000000-0000-4000-8000-000000000201";
const TEAM_B = "00000000-0000-4000-8000-000000000202";
const TEAM_BOS = "7927412c-868d-4650-b329-bdc07b20358c";
const TEAM_PHX = "811b221e-1e3e-4c60-ae9e-837b1572d757";

describe("charts", () => {
  it("shows empty states", () => {
    render(<SeasonLineChart data={[]} />);
    expect(screen.getByText("No season averages")).toBeInTheDocument();
    render(<StatBarChart data={[]} bars={[{ dataKey: "wins", fill: "red" }]} />);
    expect(screen.getByText("No chart data")).toBeInTheDocument();
    render(<WinLossDonut wins={0} losses={0} />);
    expect(screen.getByText("No record yet")).toBeInTheDocument();
    render(<GameFlowChart events={[]} />);
    expect(screen.getByText("No PBP data available.")).toBeInTheDocument();
    const { container: emptyRatings } = render(<TeamRatingsScatter teams={[]} />);
    expect(emptyRatings).toBeEmptyDOMElement();
  });

  it("renders with data", () => {
    const { container } = render(<SeasonLineChart data={[{ season: "2024-25", ppg: 27.1 }]} />);
    expect(container.querySelector(".recharts-wrapper, svg, div")).toBeTruthy();
    render(
      <StatBarChart
        data={[{ name: "Home", wins: 10, losses: 5 }]}
        bars={[
          { dataKey: "wins", fill: "green", name: "Wins" },
          { dataKey: "losses", fill: "red" },
        ]}
      />
    );
    render(<WinLossDonut wins={10} losses={5} />);
    expect(screen.getByText("10–5")).toBeInTheDocument();
    render(
      <GameFlowChart
        events={[
          {
            game_id: "0042500405",
            action_number: 1,
            period: 1,
            clock: "PT11M50.00S",
            elapsed_seconds: 10,
            score_home: 0,
            score_away: 3,
            score_differential: -3,
            scoring_side: "away",
            description: "J. Brunson 3PT Jump Shot (3 PTS)",
          },
          {
            game_id: "0042500405",
            action_number: 2,
            period: 1,
            clock: "PT11M40.00S",
            elapsed_seconds: 20,
            score_home: 1,
            score_away: 3,
            score_differential: -2,
            scoring_side: "home",
          },
          {
            game_id: "0042500405",
            action_number: 3,
            period: 1,
            clock: "PT11M30.00S",
            elapsed_seconds: 30,
            score_home: 1,
            score_away: 6,
            score_differential: -5,
            scoring_side: "away",
          },
          {
            game_id: "0042500405",
            action_number: 4,
            period: 1,
            clock: "PT11M20.00S",
            elapsed_seconds: 40,
            score_home: 2,
            score_away: 6,
            score_differential: -4,
            scoring_side: "home",
          },
          {
            game_id: "0042500405",
            action_number: 5,
            period: 1,
            clock: "PT11M00.00S",
            elapsed_seconds: 60,
            score_home: 2,
            score_away: 16,
            score_differential: -14,
            scoring_side: "away",
          },
        ]}
        flow={{
          game_id: "0042500405",
          season: "2025-26",
          game_date: "2026-06-13",
          home_team_id: TEAM_A,
          away_team_id: TEAM_B,
          home_team_abbreviation: "SAS",
          away_team_abbreviation: "NYK",
          home_primary_color: "#000000",
          home_alternate_color: "#C4CED4",
          away_primary_color: "#006BB6",
          away_alternate_color: "#F58426",
          has_play_by_play: true,
        }}
      />
    );
    expect(screen.getByText("Biggest run: NYK 16-2")).toBeInTheDocument();
    render(
      <GameFlowTooltip
        active
        payload={[
          {
            payload: {
              elapsed_seconds: 174,
              score_differential: 10,
              score_home: 18,
              score_away: 8,
              period: 1,
              clock: "PT03M06.00S",
              clock_remaining_seconds: 186,
              scoring_side: "home",
              player_name: null,
              action_type: "2pt",
              sub_type: "Driving Layup",
              description: "J. Brunson 2pt Driving Layup",
              away_abbreviation: "NYK",
              home_abbreviation: "SAS",
            },
          },
        ]}
      />
    );
    expect(screen.getByText("Q1 · 3:06")).toBeInTheDocument();
    const flowScore = document.querySelector(".recharts-tooltip-item-value") as HTMLElement;
    expect(flowScore).toHaveTextContent("NYK 8 – SAS 18 (+10)");
    expect(within(flowScore).getByText("NYK")).toHaveStyle({ color: FALLBACK_AWAY });
    expect(within(flowScore).getByText("SAS")).toHaveStyle({ color: FALLBACK_HOME });
    expect(screen.getByText("J. Brunson 2pt Driving Layup")).toBeInTheDocument();
    expect(screen.queryByText(/1630167|player_id/)).not.toBeInTheDocument();
    const { container: ratings } = render(
      <TeamRatingsScatter
        teams={[
          {
            team_id: TEAM_BOS,
            abbreviation: "BOS",
            team_name: "Boston Celtics",
            conference: "East",
            division: "Atlantic",
            pts_scored_avg: 116.4,
            pts_allowed_avg: 109.2,
          },
        ]}
      />
    );
    expect(
      screen.getByRole("heading", { name: "Team offensive vs defensive rating" })
    ).toBeInTheDocument();
    expect(ratings.querySelectorAll("path.recharts-symbols")).toHaveLength(0);
    expect(ratings.querySelector(".recharts-scatter title")).toBeNull();
    expect(screen.queryByText(/possession-adjusted ORtg/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/defensive axis is inverted/i)).not.toBeInTheDocument();
    expect(screen.getByText(QUADRANT_LABELS.topLeft)).toBeInTheDocument();
    expect(screen.getByText(QUADRANT_LABELS.topRight)).toBeInTheDocument();
    expect(screen.getByText(QUADRANT_LABELS.bottomLeft)).toBeInTheDocument();
    expect(screen.getByText(QUADRANT_LABELS.bottomRight)).toBeInTheDocument();
    const { container: logo } = render(
      <svg>
        <TeamLogoMarker
          cx={40}
          cy={40}
          payload={{
            team_id: TEAM_PHX,
            abbreviation: "PHX",
            team_name: "Phoenix Suns",
            pts_scored_avg: 112.6,
            pts_allowed_avg: 111.1,
          }}
        />
      </svg>
    );
    // Markers are the bare logo: no background circle, no clip.
    expect(logo.querySelectorAll("circle")).toHaveLength(0);
    const image = logo.querySelector("image");
    expect(image).toHaveAttribute(
      "href",
      "https://cdn.nba.com/logos/nba/1610612756/primary/L/logo.svg"
    );
    expect(image).toHaveAttribute("width", "51");
    expect(image).toHaveAttribute("height", "51");
    expect(image).toHaveAttribute("x", "14.5");
    expect(image).toHaveAttribute("y", "14.5");
    expect(image).not.toHaveAttribute("clip-path");
    expect(logo.querySelector("text")).toBeNull();
    expect(logo.querySelector("title")).toBeNull();
    render(
      <RatingsTooltip
        active
        payload={[
          {
            payload: {
              team_id: TEAM_PHX,
              abbreviation: "PHX",
              team_name: "Phoenix Suns",
              pts_scored_avg: 112.6,
              pts_allowed_avg: 111.1,
            },
          },
        ]}
      />
    );
    expect(screen.getByText("Phoenix Suns")).toBeInTheDocument();
    expect(screen.getByText("Scored 112.6 · allowed 111.1")).toBeInTheDocument();
    expect(screen.queryByText(/Phoenix Suns: 112.6 scored/)).not.toBeInTheDocument();
    render(<GameFlowTooltip active payload={[]} />);
    render(
      <GameFlowChart
        events={[
          {
            game_id: "0022400001",
            action_number: 1,
            period: 5,
            clock: "PT5M00.00S",
            elapsed_seconds: 0,
            score_home: 0,
            score_away: 0,
            score_differential: 0,
          },
        ]}
        flow={{
          game_id: "0022400001",
          season: "2024-25",
          game_date: "2024-10-22",
          home_team_id: TEAM_A,
          away_team_id: TEAM_B,
          has_play_by_play: true,
          game_elapsed_seconds: 3180,
        }}
      />
    );
  });
});
