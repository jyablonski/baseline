import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AboutPage from "@/app/about/page";

describe("about page", () => {
  it("shows the about copy without the removed scraped watermark", () => {
    render(<AboutPage />);

    const about = screen.getByRole("article");
    expect(screen.getByRole("heading", { name: "About" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Baseline" })).not.toBeInTheDocument();
    expect(about.textContent).not.toMatch(/—|&mdash;/);
    expect(about.textContent).not.toMatch(/not a general chatbot/);
    expect(about.textContent).not.toMatch(/until a dedicated screen exists/);
    expect(screen.queryByRole("heading", { name: "Last scraped" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Scraped /)).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Sources" })).toBeInTheDocument();
    const sources = screen.getByRole("heading", { name: "Sources" }).closest("section");
    expect(sources).toBeTruthy();
    expect(within(sources!).getByText("Basketball-Reference")).toBeInTheDocument();
    expect(within(sources!).getByText("The Odds API")).toBeInTheDocument();
    expect(within(sources!).getByText(/r\/nba posts and their top\s+comments/)).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "How the data gets here" })).toBeInTheDocument();
    // 08:15 UTC is 4:15 in summer and 3:15 in winter.
    expect(screen.getByText(/transformed and enriched/)).toHaveTextContent(
      /scraped everyday around [34]:15 AM ET, picking up the previous day's games and the upcoming slate\. The data is then transformed and enriched/
    );
    expect(screen.getByRole("heading", { name: "Built with" })).toBeInTheDocument();
    expect(screen.getByText(/Cube semantic layer sits over the warehouse/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Background" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent)).toEqual([
      "Sources",
      "How the data gets here",
      "Coverage",
      "Built with",
      "Developer",
      "Version",
    ]);
    expect(screen.getByRole("heading", { name: "Coverage" })).toBeInTheDocument();
    expect(screen.getByText(/Coverage defaults to the latest season/)).toBeInTheDocument();
  });

  it("credits the developer with profile links", () => {
    render(<AboutPage />);

    const developer = screen.getByRole("heading", { name: "Developer" }).closest("section");
    expect(developer).toBeTruthy();
    expect(within(developer!).getByText("Jacob Yablonski")).toBeInTheDocument();
    expect(within(developer!).getByAltText("Jacob Yablonski")).toHaveAttribute(
      "src",
      "/logo/profile.png"
    );
    expect(within(developer!).getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/jyablonski"
    );
    expect(within(developer!).getByRole("link", { name: "LinkedIn" })).toHaveAttribute(
      "href",
      "https://www.linkedin.com/in/jacobyablonski/"
    );
  });

  it("reports the build the image was made from", () => {
    render(<AboutPage />);

    const version = screen.getByRole("heading", { name: "Version" }).closest("section");
    expect(version).toBeTruthy();
    // Unit runs have no NEXT_PUBLIC_GIT_SHA baked in.
    expect(within(version!).getByText("dev")).toBeInTheDocument();
  });
});
