import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KpiCard, KpiStrip, KpiTitle } from "@/components/ui/kpi-card";

describe("kpi cards", () => {
  it("sets a plain value as the headline figure with its label and note", () => {
    render(
      <KpiStrip className="extra">
        <KpiCard label="Posts collected" value="579" note="from 173 distinct posters" />
      </KpiStrip>
    );
    expect(screen.getByText("Posts collected")).toBeInTheDocument();
    expect(screen.getByText("579")).toHaveAttribute("data-slot", "kpi-figure");
    expect(screen.getByText("from 173 distinct posters")).toBeInTheDocument();
    expect(screen.getByText("579").closest("[data-slot=kpi-strip]")).toHaveClass("extra");
    // No share was given, so there is no meter.
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders a node value as given and leaves the note out when there is none", () => {
    render(<KpiCard label="Most discussed" value={<KpiTitle>LeBron James</KpiTitle>} />);
    expect(screen.getByText("LeBron James")).toHaveAttribute("data-slot", "kpi-title");
    const card = screen.getByText("LeBron James").closest("[data-slot=kpi-card]") as HTMLElement;
    expect(card.querySelector("[data-slot=kpi-figure]")).toBeNull();
    expect(card.querySelectorAll("p")).toHaveLength(1);
  });

  it("draws the meter as a whole percent and clamps it to the track", () => {
    const { rerender } = render(<KpiCard label="Captured" value={10} progress={0.676} />);
    expect(screen.getByText("10")).toHaveAttribute("data-slot", "kpi-figure");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "68");
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ width: "68%" });

    rerender(<KpiCard label="Captured" value={10} progress={1.4} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

    rerender(<KpiCard label="Captured" value={10} progress={-0.2} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

    // A zero share is still a share: the empty track shows.
    rerender(<KpiCard label="Captured" value={10} progress={0} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});
