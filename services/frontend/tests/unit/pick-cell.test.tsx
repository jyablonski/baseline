import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PickCell, StakeEditor } from "@/components/account/pick-cell";
import type { ScheduledGame, UserPick } from "@/lib/types";

const game = {
  game_id: "g-1",
  home_team_id: "home",
  away_team_id: "away",
  home_team_abbreviation: "GSW",
  away_team_abbreviation: "LAL",
  home_moneyline: -150,
  away_moneyline: 130,
} as unknown as ScheduledGame;

const unpriced = { ...game, home_moneyline: null, away_moneyline: null } as ScheduledGame;

function pickOn(teamId: string, extra: Partial<UserPick> = {}): UserPick {
  return {
    game_id: "g-1",
    picked_team_id: teamId,
    stake: null,
    moneyline: teamId === "home" ? -150 : 130,
    result: "pending",
    profit: null,
    ...extra,
  } as UserPick;
}

function setup(props: Partial<Parameters<typeof PickCell>[0]> = {}) {
  const onSave = vi.fn();
  const onRemove = vi.fn();
  const onEditStake = vi.fn();
  render(
    <PickCell
      game={game}
      pick={undefined}
      busy={false}
      editing={false}
      onSave={onSave}
      onRemove={onRemove}
      onEditStake={onEditStake}
      {...props}
    />
  );
  return { onSave, onRemove, onEditStake };
}

describe("PickCell", () => {
  it("offers both sides and nothing else until one is picked", () => {
    setup();
    expect(screen.getByRole("button", { name: "Pick LAL" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "Pick GSW" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Clear pick/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stake/i })).not.toBeInTheDocument();
  });

  it("saves a side with one click and no stake", () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Pick GSW" }));
    expect(onSave).toHaveBeenCalledWith({ gameId: "g-1", teamId: "home", stake: null });
  });

  it("marks the saved side and offers a stake as an optional next step", () => {
    const { onEditStake } = setup({ pick: pickOn("home") });
    const taken = screen.getByRole("button", { name: "Pick GSW" });
    expect(taken).toHaveAttribute("aria-pressed", "true");
    // Already saved, so pressing it again would do nothing useful.
    expect(taken).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add stake" }));
    expect(onEditStake).toHaveBeenCalledWith("g-1");
  });

  it("shows what a stake stands to win and lets it be edited", () => {
    setup({ pick: pickOn("home", { stake: 50 }) });
    // $50 at -150 wins $33.33, to the cent.
    expect(screen.getByText("$50 to win $33.33")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit stake" })).toBeInTheDocument();
  });

  it("carries the stake to the other side, which re-prices it", () => {
    const { onSave } = setup({ pick: pickOn("home", { stake: 50 }) });
    fireEvent.click(screen.getByRole("button", { name: "Pick LAL" }));
    expect(onSave).toHaveBeenCalledWith({ gameId: "g-1", teamId: "away", stake: 50 });
  });

  it("offers no stake on a game with no moneyline", () => {
    const { onSave } = setup({ game: unpriced, pick: pickOn("home", { moneyline: null }) });
    expect(screen.queryByRole("button", { name: /stake/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pick LAL" }));
    expect(onSave).toHaveBeenCalledWith({ gameId: "g-1", teamId: "away", stake: null });
  });

  it("hides the stake link while the editor is already open", () => {
    setup({ pick: pickOn("home"), editing: true });
    expect(screen.queryByRole("button", { name: "Add stake" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clear pick/ })).toBeInTheDocument();
  });

  it("clears the pick", () => {
    const { onRemove } = setup({ pick: pickOn("home") });
    fireEvent.click(screen.getByRole("button", { name: "Clear pick for LAL at GSW" }));
    expect(onRemove).toHaveBeenCalledWith("g-1");
  });

  it("locks every control while a save is in flight", () => {
    setup({ pick: pickOn("home"), busy: true });
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });

  it("falls back to Away and Home when a team has no abbreviation", () => {
    setup({
      game: {
        ...game,
        home_team_abbreviation: null,
        away_team_abbreviation: null,
      } as ScheduledGame,
    });
    expect(screen.getByRole("button", { name: "Pick Away" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick Home" })).toBeInTheDocument();
  });
});

describe("StakeEditor", () => {
  function editor(pick: UserPick, busy = false) {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<StakeEditor game={game} pick={pick} busy={busy} onSave={onSave} onClose={onClose} />);
    return { onSave, onClose };
  }

  it("starts on None, which keeps the pick record-only", () => {
    const { onSave, onClose } = editor(pickOn("away"));
    expect(screen.getByText("Stake on LAL +130 (optional)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Counts toward your record only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save stake" }));
    expect(onSave).toHaveBeenCalledWith({ gameId: "g-1", teamId: "away", stake: null });
    expect(onClose).toHaveBeenCalled();
  });

  it("stakes a preset and shows what it would win first", () => {
    const { onSave } = editor(pickOn("away"));
    fireEvent.click(screen.getByRole("button", { name: "$50" }));
    // $50 at +130 wins $65.
    expect(screen.getByText("$50 to win $65")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save stake" }));
    expect(onSave).toHaveBeenCalledWith({ gameId: "g-1", teamId: "away", stake: 50 });
  });

  it("takes any other whole amount up to the limit, with no balance to check", () => {
    const { onSave } = editor(pickOn("home"));
    const other = screen.getByLabelText("Other stake");
    fireEvent.change(other, { target: { value: "1000" } });
    expect(other).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByText("$1,000 to win $666.66")).toBeInTheDocument();
    // Typing an amount takes the selection off the chips.
    expect(screen.getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Save stake" }));
    expect(onSave).toHaveBeenCalledWith({ gameId: "g-1", teamId: "home", stake: 1000 });
  });

  it("refuses an amount that is not a whole number in range", () => {
    const { onSave } = editor(pickOn("home"));
    const other = screen.getByLabelText("Other stake");
    for (const value of ["1001", "0", "-5", "2.5", "lots"]) {
      fireEvent.change(other, { target: { value } });
      expect(other).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText("Whole dollars, from $1 to $1,000.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save stake" })).toBeDisabled();
      fireEvent.submit(other.closest("form") as HTMLFormElement);
    }
    expect(onSave).not.toHaveBeenCalled();
    // Emptying the field goes back to no stake, and a chip clears the field.
    fireEvent.change(other, { target: { value: " " } });
    expect(screen.getByText("Counts toward your record only")).toBeInTheDocument();
    fireEvent.change(other, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "$25" }));
    expect(other).toHaveValue("");
    expect(screen.getByRole("button", { name: "$25" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens on the stake already saved, preset or not", () => {
    const { unmount } = render(
      <StakeEditor
        game={game}
        pick={pickOn("home", { stake: 25 })}
        busy={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "$25" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Other stake")).toHaveValue("");
    unmount();
    editor(pickOn("home", { stake: 40 }));
    expect(screen.getByLabelText("Other stake")).toHaveValue("40");
  });

  it("cancels without saving, and locks while a save is in flight", () => {
    const { onSave, onClose } = editor(pickOn("home"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("disables everything while busy", () => {
    editor(pickOn("home"), true);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    expect(screen.getByLabelText("Other stake")).toBeDisabled();
  });
});
