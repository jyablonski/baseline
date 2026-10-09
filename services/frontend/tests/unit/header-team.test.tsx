import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/teams/1610612744",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("season=2025-26"),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getStatus: async () => ({
      last_scraped_at: null,
      player_count: 0,
      game_count: 0,
      season_count: 0,
      first_season: null,
      last_season: null,
    }),
  },
}));

import { Header } from "@/components/layout/header";
import { Providers } from "@/components/providers";

describe("header team profile", () => {
  it("marks Teams as the active primary tab", () => {
    render(
      <Providers>
        <Header />
      </Providers>
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Teams" })).toHaveClass("ct-tab-active");
    // The scrape stamp lives on the home page now, not in the chrome.
    expect(screen.queryByText(/Scraped/)).not.toBeInTheDocument();
  });
});
