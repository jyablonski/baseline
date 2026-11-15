import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  account: null as { name: string; hasAccount: boolean } | null,
  accountLoading: false,
  user: null as { timezone: string | null } | null,
  followed: new Set<string>(),
  mutate: vi.fn(),
  pending: false,
  error: null as Error | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/teams/denver-nuggets",
  useSearchParams: () => new URLSearchParams("tab=roster"),
}));
vi.mock("@/lib/account", () => ({
  useAccount: () => ({ account: state.account, isLoading: state.accountLoading }),
}));
vi.mock("@/hooks/use-profile", () => ({
  useProfile: () => ({
    user: state.user,
    followedTeamIds: state.followed,
    setTeamFollow: { mutate: state.mutate, isPending: state.pending, error: state.error },
  }),
}));

import { FollowTeamButton } from "@/components/account/follow-team-button";
import { involvesFollowed, keepFollowed, moveOne, searchTeams } from "@/lib/follows";

const DEN = "00000000-0000-4000-8000-0000000000de";

function game(id: string, home: string, away: string) {
  return { game_id: id, home_team_id: home, away_team_id: away };
}

describe("follow helpers", () => {
  it("knows a followed team's game from either side", () => {
    const followed = new Set(["den"]);
    expect(involvesFollowed(game("1", "den", "lal"), followed)).toBe(true);
    expect(involvesFollowed(game("2", "bos", "den"), followed)).toBe(true);
    expect(involvesFollowed(game("3", "bos", "nyk"), followed)).toBe(false);
  });

  it("keeps every followed game inside the cap, in the original order", () => {
    const games = [
      game("a", "bos", "nyk"),
      game("b", "mia", "orl"),
      game("c", "phx", "sac"),
      game("d", "den", "lal"),
    ];
    const kept = keepFollowed(games, new Set(["den"]), 3);
    expect(kept.map((item) => item.game_id)).toEqual(["a", "b", "d"]);
    // No follows is a plain slice.
    expect(keepFollowed(games, new Set(), 2).map((item) => item.game_id)).toEqual(["a", "b"]);
  });

  it("searches by abbreviation first, then city and name, skipping followed teams", () => {
    const teams = [
      { team_id: "sas", abbreviation: "SAS", team_name: "San Antonio Spurs", city: "San Antonio" },
      {
        team_id: "por",
        abbreviation: "POR",
        team_name: "Portland Trail Blazers",
        city: "Portland",
      },
      { team_id: "sac", abbreviation: "SAC", team_name: "Sacramento Kings", city: "Sacramento" },
    ];
    expect(searchTeams(teams, "sa", new Set()).map((team) => team.team_id)).toEqual(["sas", "sac"]);
    expect(searchTeams(teams, "  blazers ", new Set()).map((team) => team.team_id)).toEqual([
      "por",
    ]);
    expect(searchTeams(teams, "san", new Set(["sas"]))).toEqual([]);
    expect(searchTeams(teams, "  ", new Set())).toEqual([]);
  });

  it("moves one item a place, and leaves the ends alone", () => {
    expect(moveOne(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveOne(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveOne(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveOne(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("follow button", () => {
  beforeEach(() => {
    state.account = { name: "Pat", hasAccount: true };
    state.accountLoading = false;
    state.user = { timezone: null };
    state.followed = new Set();
    state.pending = false;
    state.error = null;
    state.mutate.mockReset();
  });

  it("sends a signed-out visitor to sign in and back to this page", () => {
    state.account = null;
    render(<FollowTeamButton teamId={DEN} teamName="Denver Nuggets" />);
    expect(screen.getByRole("link", { name: "Sign in to follow" })).toHaveAttribute(
      "href",
      "/signin?callbackUrl=%2Fteams%2Fdenver-nuggets%3Ftab%3Droster"
    );
  });

  it("follows and unfollows", () => {
    const { rerender } = render(<FollowTeamButton teamId={DEN} teamName="Denver Nuggets" />);
    const follow = screen.getByRole("button", { name: "Follow Denver Nuggets" });
    expect(follow).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(follow);
    expect(state.mutate).toHaveBeenCalledWith({ teamId: DEN, following: true });

    state.followed = new Set([DEN]);
    rerender(<FollowTeamButton teamId={DEN} teamName="Denver Nuggets" />);
    const unfollow = screen.getByRole("button", { name: "Unfollow Denver Nuggets" });
    expect(unfollow).toHaveTextContent("Following ✓");
    fireEvent.click(unfollow);
    expect(state.mutate).toHaveBeenLastCalledWith({ teamId: DEN, following: false });
  });

  it("says why a follow was refused", () => {
    state.error = new Error("You can follow up to 5 teams. Unfollow one to add another.");
    render(<FollowTeamButton teamId={DEN} teamName="Denver Nuggets" />);
    expect(screen.getByRole("alert")).toHaveTextContent("You can follow up to 5 teams.");
  });

  it("shows nothing until it knows who is asking", () => {
    state.accountLoading = true;
    const { container, rerender } = render(
      <FollowTeamButton teamId={DEN} teamName="Denver Nuggets" />
    );
    expect(container).toBeEmptyDOMElement();
    state.accountLoading = false;
    state.user = null;
    rerender(<FollowTeamButton teamId={DEN} teamName="Denver Nuggets" />);
    expect(container).toBeEmptyDOMElement();
  });
});
