import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/schedule",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("season=2024-25"),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listSeasons: async () => ({
      data: [{ season: "2024-25" }],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    listScheduleDates: async () => ({ data: [], meta: { total: 0, limit: 0, offset: 0 } }),
    listSchedule: async () => ({
      data: [],
      meta: { total: 0, limit: 50, offset: 0 },
    }),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import SchedulePage from "@/app/schedule/page";
import { Providers } from "@/components/providers";

describe("schedule page empty", () => {
  it("shows an empty state when no upcoming games are loaded", async () => {
    render(
      <Providers>
        <SchedulePage />
      </Providers>
    );
    await waitFor(() => {
      expect(screen.getByText("No upcoming games")).toBeInTheDocument();
    });
    expect(screen.getByText(/No scheduled games for 2024-25 yet/)).toBeInTheDocument();
    expect(screen.queryByText(/scrape-games|then dbt|dbt/i)).not.toBeInTheDocument();
  });
});
