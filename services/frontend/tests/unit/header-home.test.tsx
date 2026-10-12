import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getStatus: async () => ({
      last_scraped_at: "2026-09-04T04:12:00Z",
      player_count: 10,
      game_count: 20,
      season_count: 2,
      first_season: "2010-11",
      last_season: "2025-26",
    }),
  },
}));

import { Header } from "@/components/layout/header";
import { Providers } from "@/components/providers";

describe("header home", () => {
  it("renders Baseline tabs with Home active and Ask as a primary tab", () => {
    render(
      <Providers>
        <Header />
      </Providers>
    );
    expect(screen.getByRole("link", { name: "Baseline" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Ask" })).toHaveAttribute("href", "/ask");
    expect(within(nav).getByRole("link", { name: "Home" })).toBeInTheDocument();
    // About lives in the footer, with the other pages that are not data.
    expect(within(nav).queryByRole("link", { name: "About" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Player or team")).not.toBeInTheDocument();
    expect(screen.queryByText("Season")).not.toBeInTheDocument();
    expect(screen.queryByText(/API v1/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Court Vision")).not.toBeInTheDocument();
  });
});
