import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { B2BBadge, B2BLegend } from "@/components/games/b2b-badge";
import { lastNight, lastNightResult } from "@/lib/back-to-back";
import { streakSentence } from "@/lib/team-form";
import type { ScheduledGame } from "@/lib/types";

const game: ScheduledGame = {
  game_id: "g1",
  season: "2026-27",
  game_date: "2026-10-24",
  status: "Scheduled",
  home_team_id: "phi",
  away_team_id: "mil",
  home_team_abbreviation: "PHI",
  away_team_abbreviation: "MIL",
  away_is_back_to_back: true,
  away_last_night_opponent_abbreviation: "ORL",
  away_last_night_was_home: true,
  away_last_night_score: 108,
  away_last_night_opponent_score: 115,
};

describe("lastNight", () => {
  it("reads one side, and nothing for a team that did not play the day before", () => {
    expect(lastNight(game, "away")).toEqual({
      abbreviation: "MIL",
      opponentAbbreviation: "ORL",
      wasHome: true,
      teamScore: 108,
      opponentScore: 115,
    });
    expect(lastNight(game, "home")).toBeNull();
    expect(
      lastNight({ ...game, home_is_back_to_back: true, home_team_abbreviation: null }, "home")
    ).toMatchObject({ abbreviation: "Home", opponentAbbreviation: null, teamScore: null });
  });
});

describe("lastNightResult", () => {
  const night = lastNight(game, "away")!;

  it("puts the tired team's score first, vs at home and @ away", () => {
    expect(lastNightResult(night)).toBe("L 108–115 vs ORL");
    expect(lastNightResult({ ...night, wasHome: false, teamScore: 120 })).toBe("W 120–115 @ ORL");
  });

  it("drops the score while last night is not Final, and everything without an opponent", () => {
    expect(lastNightResult({ ...night, teamScore: null, opponentScore: null })).toBe("vs ORL");
    expect(lastNightResult({ ...night, opponentAbbreviation: null })).toBeNull();
  });
});

describe("streakSentence", () => {
  it("spells out a W/L streak", () => {
    expect(streakSentence("W6")).toEqual({ length: 6, sentence: "has won 6 straight" });
    expect(streakSentence("L3")).toEqual({ length: 3, sentence: "has lost 3 straight" });
    expect(streakSentence("")).toBeNull();
    expect(streakSentence(null)).toBeNull();
    expect(streakSentence("T2")).toBeNull();
  });
});

describe("B2BBadge", () => {
  it("is a labelled button that opens last night's detail", async () => {
    render(<B2BBadge game={game} side="away" />);
    const badge = screen.getByRole("button", { name: "MIL played last night: L 108–115 vs ORL" });
    expect(badge).toHaveTextContent("B2B");

    fireEvent.click(badge);
    expect(await screen.findByText("MIL played last night")).toBeInTheDocument();
    expect(
      screen.getByText("L 108–115 vs ORL · second night of a back-to-back")
    ).toBeInTheDocument();
  });

  it("renders nothing for a rested team", () => {
    const { container } = render(<B2BBadge game={game} side="home" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still opens before last night's score is in", async () => {
    render(
      <B2BBadge
        game={{ ...game, away_last_night_score: null, away_last_night_opponent_score: null }}
        side="away"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "MIL played last night: vs ORL" }));
    expect(await screen.findByText("vs ORL · second night of a back-to-back")).toBeInTheDocument();
  });

  it("names just the team when last night's opponent is unknown", () => {
    render(
      <B2BBadge game={{ ...game, away_last_night_opponent_abbreviation: null }} side="away" />
    );
    expect(screen.getByRole("button", { name: "MIL played last night" })).toBeInTheDocument();
  });

  it("has a legend whose sample badge is hidden from screen readers", () => {
    render(<B2BLegend />);
    expect(screen.getByText("Played last night")).toBeInTheDocument();
    expect(screen.getByText("B2B")).toHaveAttribute("aria-hidden", "true");
  });
});
