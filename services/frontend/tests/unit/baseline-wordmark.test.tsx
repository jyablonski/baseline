import { readFileSync } from "node:fs";
import path from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  BASELINE_INK,
  BASELINE_LINE_GREEN,
  BASELINE_PAPER,
  FAVICON_RULE_D,
  FAVICON_VIEWBOX,
} from "@/components/brand/baseline-mark";
import { BaselineWordmark } from "@/components/brand/baseline-wordmark";

describe("BaselineWordmark", () => {
  it("renders the word as live text in the nav's face, over a hidden lane arc", () => {
    const { container } = render(<BaselineWordmark />);
    const word = container.firstElementChild;
    expect(word).toHaveTextContent("Baseline");
    expect(word).toHaveClass("font-sans", "font-semibold");
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("svg")).toHaveAttribute("width", "36");
  });
});

describe("favicon mark", () => {
  it("uses the official B-on-the-line mark and flips the B in dark color-scheme", () => {
    const iconSvg = readFileSync(path.resolve(__dirname, "../../src/app/icon.svg"), "utf8");
    expect(iconSvg).toContain(`viewBox="${FAVICON_VIEWBOX}"`);
    expect(iconSvg).toContain("@media (prefers-color-scheme: dark)");
    expect(iconSvg).toContain(BASELINE_INK);
    expect(iconSvg).toContain(BASELINE_PAPER);
    expect(iconSvg).toContain(BASELINE_LINE_GREEN);
    expect(iconSvg).toContain(FAVICON_RULE_D);
    expect(iconSvg).not.toContain("<text");
    expect(iconSvg).not.toContain("a17 17");
  });
});
