import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sparkline } from "@/components/charts/sparkline";

describe("Sparkline", () => {
  it("draws the games it has, skipping gaps, over a dashed reference", () => {
    const { container } = render(<Sparkline values={[1, null, 3, 2]} reference={2} width={100} />);
    const line = container.querySelector("polyline");
    expect(line?.getAttribute("points")?.split(" ")).toHaveLength(3);
    expect(container.querySelector("line")).toHaveAttribute("stroke-dasharray", "3 3");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden");
  });

  it("draws nothing with fewer than two games", () => {
    const { container } = render(<Sparkline values={[null, 4]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("keeps a flat line off the floor", () => {
    const { container } = render(<Sparkline values={[5, 5, 5]} height={30} />);
    const ys = container
      .querySelector("polyline")
      ?.getAttribute("points")
      ?.split(" ")
      .map((point) => Number(point.split(",")[1]));
    expect(ys).toEqual([15, 15, 15]);
  });
});
