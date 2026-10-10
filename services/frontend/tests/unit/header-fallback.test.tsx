import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/unknown",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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

describe("header fallback", () => {
  it("keeps the Baseline wordmark on unknown routes", () => {
    render(
      <Providers>
        <Header />
      </Providers>
    );
    expect(screen.getByRole("link", { name: "Baseline" })).toHaveAttribute("href", "/");
    expect(screen.queryByPlaceholderText("Player or team")).not.toBeInTheDocument();
    // The scrape stamp lives on the home page now, not in the chrome.
    expect(screen.queryByText(/Scraped/)).not.toBeInTheDocument();
  });
});
