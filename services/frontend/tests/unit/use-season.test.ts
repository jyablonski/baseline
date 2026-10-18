import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const search = new URLSearchParams("season=2024-25");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/teams",
  useSearchParams: () => search,
}));

vi.mock("@/lib/api", () => ({
  api: {
    listSeasons: async () => ({
      data: [{ season: "2025-26" }, { season: "2024-25" }],
      meta: { total: 2, limit: 2, offset: 0 },
    }),
  },
}));

import { Providers } from "@/components/providers";
import { useSeason } from "@/hooks/use-season";

describe("useSeason", () => {
  it("reads the URL season when it exists in the list", async () => {
    const { result } = renderHook(() => useSeason(), { wrapper: Providers });
    await waitFor(() => {
      expect(result.current.season).toBe("2024-25");
    });
    result.current.setSeason("2025-26");
    expect(replace).toHaveBeenCalledWith("/teams?season=2025-26");
    result.current.setSeason("");
    expect(replace).toHaveBeenCalledWith("/teams");
  });
});
