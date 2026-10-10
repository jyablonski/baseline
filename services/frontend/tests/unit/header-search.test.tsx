import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/ask",
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

describe("header search", () => {
  it("has no global search or season control and opens the mobile nav", async () => {
    render(
      <Providers>
        <Header />
      </Providers>
    );
    expect(screen.queryByText(/Scraped/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Player or team")).not.toBeInTheDocument();
    expect(screen.queryByText("⌘K")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const mobile = screen.getByRole("navigation", { name: "Primary mobile" });
    expect(mobile).toBeInTheDocument();
    expect(mobile.textContent).toContain("Ask");
  });
});
