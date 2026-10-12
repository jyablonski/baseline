import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Footer } from "@/components/layout/footer";

describe("footer", () => {
  it("links to the policies and a contact address, over the disclaimer", () => {
    render(<Footer />);

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(within(footer).getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy"
    );
    expect(within(footer).getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(within(footer).getByRole("link", { name: "Contact" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^mailto:/)
    );
    expect(footer).toHaveTextContent("Not affiliated with the NBA or its teams.");
    expect(footer).not.toHaveTextContent(/picks/i);
  });
});
