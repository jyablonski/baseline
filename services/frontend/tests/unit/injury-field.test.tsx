import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const injuries = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], calls: 0 }));

vi.mock("@/lib/api", () => ({
  api: {
    getGameInjuries: async () => {
      injuries.calls += 1;
      if (injuries.rows.length === 0) throw new Error("Report unavailable");
      return { data: injuries.rows, meta: { total: injuries.rows.length, limit: 0, offset: 0 } };
    },
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import { InjuryField } from "@/components/injuries/injury-field";
import type { ScheduledGame } from "@/lib/types";

function game(overrides: Partial<ScheduledGame> = {}) {
  return {
    game_id: "g-1",
    away_team_abbreviation: "IND",
    home_team_abbreviation: "MIA",
    injuries_out: 1,
    injuries_listed: 2,
    has_key_injury: true,
    key_players_out: 1,
    ...overrides,
  } as ScheduledGame;
}

function row(overrides: Record<string, unknown>) {
  return {
    game_id: "g-1",
    side: "away",
    player_id: "p-1",
    player_name: "Tyrese Haliburton",
    injury_status: "Out",
    injury_detail: "Hamstring",
    is_notable: true,
    ppg: 18.6,
    apg: 9.2,
    ...overrides,
  };
}

function renderField(overrides: Partial<ScheduledGame> = {}) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InjuryField game={game(overrides)} />
    </QueryClientProvider>
  );
  return screen.getByTestId("injury-field");
}

describe("InjuryField", () => {
  beforeEach(() => {
    injuries.calls = 0;
    injuries.rows = [
      row({}),
      row({
        player_id: "p-2",
        player_name: "Obi Toppin",
        injury_status: "Day To Day",
        injury_detail: null,
        ppg: null,
        apg: null,
      }),
    ];
  });

  it("counts everyone listed, in red when a key player is out", () => {
    expect(renderField()).toHaveTextContent("3 listed");
    expect(screen.getByTestId("injury-field")).toHaveClass("text-destructive");
  });

  it("stays grey for a key player who is only Day To Day", () => {
    const field = renderField({ injuries_out: 0, key_players_out: 0 });
    expect(field).toHaveTextContent("2 listed");
    expect(field).toHaveClass("text-ink-2");
  });

  it("fetches nothing until opened, then shows both teams and a way to the game", async () => {
    const field = renderField();
    expect(injuries.calls).toBe(0);
    fireEvent.click(field);

    const dialog = await screen.findByRole("dialog", { name: "Injury report · IND @ MIA" });
    expect(within(dialog).getByText("Morning report")).toBeInTheDocument();
    const [haliburton, toppin] = await within(dialog).findAllByTestId("injury-field-player");
    expect(haliburton).toHaveTextContent("Out");
    expect(haliburton).toHaveTextContent("Hamstring · 18.6 ppg, 9.2 apg");
    expect(toppin).toHaveTextContent("Day To Day");
    expect(within(dialog).getByText("Nobody listed.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Full report →" })).toHaveAttribute(
      "href",
      "/games/g-1"
    );
    expect(injuries.calls).toBe(1);
  });

  it("says so when the report cannot be read", async () => {
    injuries.rows = [];
    fireEvent.click(renderField());
    await waitFor(() => expect(screen.getByText("Report unavailable")).toBeInTheDocument());
  });
});
