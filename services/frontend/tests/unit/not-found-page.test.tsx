import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFound from "@/app/not-found";

describe("not found page", () => {
  it("says the page is missing", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { name: "404 — Page not found" })).toBeInTheDocument();
  });
});
