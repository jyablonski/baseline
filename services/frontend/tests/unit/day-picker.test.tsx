import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DayCalendar, DayHeader } from "@/components/day-picker";

describe("DayHeader", () => {
  it("puts the summary beside the title and controls on the right", () => {
    render(
      <DayHeader title="Today · Sunday, November 22" summary="7 games · PST">
        <span>My teams</span>
      </DayHeader>
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Today · Sunday, November 22"
    );
    expect(screen.getByText("7 games · PST")).toBeInTheDocument();
    expect(screen.getByText("My teams")).toBeInTheDocument();
  });
});

describe("DayCalendar", () => {
  it("opens a month grid where only game days can be picked, with a way back to today", () => {
    const onPick = vi.fn();
    render(
      <DayCalendar
        current="2026-10-24"
        home="2026-10-22"
        homeLabel="Today"
        gameDays={["2026-10-24", "2026-10-22"]}
        onPick={onPick}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Pick a game day, showing Sat, Oct 24/ }));
    expect(screen.getByRole("button", { name: "Fri, Oct 23, no games" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sat, Oct 24" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onPick).toHaveBeenCalledWith("2026-10-22");
  });
});
