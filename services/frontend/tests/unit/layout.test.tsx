import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/players/lebron-james",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getStatus: async () => ({
      last_scraped_at: "2026-09-04T04:12:00Z",
      player_count: 1,
      game_count: 1,
      season_count: 1,
      first_season: "2010-11",
      last_season: "2025-26",
    }),
  },
}));

import { Header } from "@/components/layout/header";
import { Providers } from "@/components/providers";

describe("layout", () => {
  it("uses a single header bar with Ask as a primary tab", () => {
    render(
      <Providers>
        <Header />
      </Providers>
    );
    expect(screen.queryByText("Court Vision")).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Players" })).toHaveAttribute("href", "/players");
    expect(within(nav).getByRole("link", { name: "Ask" })).toHaveAttribute("href", "/ask");
    expect(within(nav).queryByRole("link", { name: "Compare" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Player or team")).not.toBeInTheDocument();
  });
});
