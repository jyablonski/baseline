import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DayHeader, DayPicker } from "@/components/day-picker";

describe("DayHeader", () => {
  it("draws a strong rule by default and a light one when a table head follows", () => {
    const { container, rerender } = render(
      <DayHeader title="Latest · Saturday, June 13" summary="Finals · 1 game">
        <span>picker</span>
      </DayHeader>
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row).toHaveClass("border-rule-strong");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Latest · Saturday, June 13"
    );
    expect(screen.getByText("Finals · 1 game")).toBeInTheDocument();
    expect(screen.getByText("picker")).toBeInTheDocument();

    rerender(
      <DayHeader title="Today · Thursday, October 22" rule="light">
        <span>picker</span>
      </DayHeader>
    );
    expect(row).toHaveClass("border-rule");
    expect(row).not.toHaveClass("border-rule-strong");
  });

  it("keeps the summary line's height while the day loads, so the rule does not jump", () => {
    const { container } = render(
      <DayHeader title="Friday, October 23" summary={null}>
        <span />
      </DayHeader>
    );
    const summary = container.querySelector("h2 + p");
    expect(summary).toBeEmptyDOMElement();
    expect(summary).toHaveClass("min-h-[1lh]");
  });
});

describe("DayPicker", () => {
  it("gives the date button a fixed width so the arrows do not move between days", () => {
    render(
      <DayPicker
        current="2026-10-22"
        home="2026-10-22"
        homeLabel="Today"
        older={null}
        newer="2026-10-24"
        gameDays={["2026-10-24", "2026-10-22"]}
        onPick={() => {}}
      />
    );
    const trigger = screen.getByRole("button", { name: /Pick a game day, showing Thu, Oct 22/ });
    expect(trigger).toHaveClass("min-w-[9.5em]", "justify-center");
    expect(screen.getByRole("button", { name: "Earlier game day" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Later game day" })).toBeEnabled();
  });
});
