import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/schedule",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("season=2026-27"),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listSeasons: async () => ({
      data: [{ season: "2026-27" }],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    listSchedule: async () => ({
      data: [
        {
          game_id: "0022600100",
          season: "2026-27",
          game_date: "2026-10-22",
          status: "Scheduled",
          home_team_id: 1610612744,
          away_team_id: 1610612747,
          home_team_abbreviation: "GSW",
          away_team_abbreviation: "LAL",
          arena: "Chase Center",
        },
      ],
      meta: { total: 1, limit: 50, offset: 0 },
    }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import SchedulePage from "@/app/schedule/page";
import { Providers } from "@/components/providers";

describe("schedule page", () => {
  it("lists upcoming scheduled games with matchup and arena", async () => {
    render(
      <Providers>
        <SchedulePage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "LAL" })).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Season")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LAL" })).toBeInTheDocument();
    expect(screen.getByText("@")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GSW" })).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Chase Center")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GSW" })).toHaveAttribute(
      "href",
      "/teams/1610612744?season=2026-27"
    );
    expect(screen.queryByText("PBP →")).not.toBeInTheDocument();
  });
});
