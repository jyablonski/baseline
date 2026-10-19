import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryNlp = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/ask",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("season=2025-26"),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listSeasons: async () => ({
      data: [{ season: "2025-26" }],
      meta: { total: 1, limit: 1, offset: 0 },
    }),
    queryNlp: (...args: unknown[]) => queryNlp(...args),
  },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import AskPage from "@/app/ask/page";
import { Providers } from "@/components/providers";

function renderPage() {
  return render(
    <Providers>
      <AskPage />
    </Providers>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ask page", () => {
  beforeEach(() => {
    queryNlp.mockReset();
  });

  it("shows an empty state before the first ask", () => {
    renderPage();
    expect(screen.getByText("Nothing asked yet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Try" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Question" })).toBeInTheDocument();
    for (const group of ["Teams", "Players", "Games", "Standings"]) {
      expect(screen.getByRole("region", { name: group })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  it("replaces the previous Q&A with the latest submit", async () => {
    queryNlp
      .mockResolvedValueOnce({
        answer: "Stephen Curry remaining salary is $55,761,217.",
        data: [{ player: "Stephen Curry", remaining_salary: 55761217 }],
        entities: [
          { kind: "player", label: "Stephen Curry" },
          { kind: "topic", label: "Salary" },
        ],
      })
      .mockResolvedValueOnce({
        answer: "Golden State Warriors remaining payroll is $210,000,000.",
        data: [{ team: "Golden State Warriors", remaining_payroll: 210000000 }],
        entities: [{ kind: "team", label: "Golden State Warriors" }],
      });

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Curry's salary/i }));
    await waitFor(() => {
      expect(
        screen.getByText("Stephen Curry remaining salary is $55,761,217.")
      ).toBeInTheDocument();
    });
    const first = screen.getByRole("article", { name: "Latest question and answer" });
    expect(within(first).getByText("Reading this as")).toBeInTheDocument();
    expect(within(first).getByText("Player")).toBeInTheDocument();
    expect(within(first).getByText("Salary")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stephen Curry page →" })).toHaveAttribute(
      "href",
      "/players/stephen-curry"
    );
    // The question stays in the box after asking.
    expect(screen.getByRole("textbox", { name: "Question" })).toHaveValue(
      "What is Curry's salary?"
    );

    fireEvent.click(screen.getByRole("button", { name: /Warriors payroll/i }));
    await waitFor(() => {
      expect(
        screen.getByText("Golden State Warriors remaining payroll is $210,000,000.")
      ).toBeInTheDocument();
    });

    const latest = screen.getByRole("article", { name: "Latest question and answer" });
    expect(
      screen.queryByText("Stephen Curry remaining salary is $55,761,217.")
    ).not.toBeInTheDocument();
    expect(within(latest).queryByText("Stephen Curry")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Question" })).toHaveValue(
      "What is the Warriors payroll?"
    );
    expect(screen.getByRole("link", { name: "Golden State Warriors page →" })).toHaveAttribute(
      "href",
      "/teams/golden-state-warriors"
    );
    expect(queryNlp).toHaveBeenCalledTimes(2);
    expect(queryNlp).toHaveBeenNthCalledWith(1, "What is Curry's salary?", "2025-26");
    expect(queryNlp).toHaveBeenNthCalledWith(2, "What is the Warriors payroll?", "2025-26");
  });

  it("clears the previous answer and shows loading on the current slot", async () => {
    queryNlp.mockResolvedValueOnce({
      answer: "Kawhi Leonard has 12 back-to-back sets",
      data: [],
    });
    const second = deferred<{ answer: string; data: never[] }>();
    queryNlp.mockReturnValueOnce(second.promise);

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /back-to-backs has Kawhi/i }));
    await waitFor(() => {
      expect(screen.getByText("Kawhi Leonard has 12 back-to-back sets")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /leads the West/i }));
    await waitFor(() => {
      expect(screen.queryByText("Kawhi Leonard has 12 back-to-back sets")).not.toBeInTheDocument();
      expect(screen.getByRole("status", { name: "Asking…" })).toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Question" })).toHaveValue("Who leads the West?");

    second.resolve({ answer: "Oklahoma City is first in the West.", data: [] });
    await waitFor(() => {
      expect(screen.getByText("Oklahoma City is first in the West.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("status", { name: "Asking…" })).not.toBeInTheDocument();
  });

  it("submits the typed question and shows an API error on the current slot", async () => {
    queryNlp.mockRejectedValueOnce(new Error("Unable to load data. Try again in a moment."));

    renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
      target: { value: "Who leads the East?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => {
      expect(screen.getByText("Unable to load data. Try again in a moment.")).toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Question" })).toHaveValue("Who leads the East?");
    expect(screen.queryByText("Nothing asked yet")).not.toBeInTheDocument();
  });

  it("asks a follow-up in one click", async () => {
    queryNlp
      .mockResolvedValueOnce({
        answer: "Golden State Warriors are 3-1 in Chicago.",
        data: [],
        entities: [
          { kind: "team", label: "Golden State Warriors" },
          { kind: "city", label: "Chicago" },
        ],
        follow_ups: ["Golden State Warriors payroll"],
      })
      .mockResolvedValueOnce({ answer: "Golden State Warriors payroll is $180,000,000." });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /win percentage in Chicago/i }));
    const next = await screen.findByRole("region", { name: "Ask next" });
    // A city is a filter, not a page: only the team gets a link.
    expect(screen.getAllByRole("link", { name: / page →$/ })).toHaveLength(1);

    fireEvent.click(within(next).getByRole("button", { name: "Golden State Warriors payroll" }));
    await screen.findByText("Golden State Warriors payroll is $180,000,000.");
    expect(queryNlp).toHaveBeenLastCalledWith("Golden State Warriors payroll", "2025-26");
    expect(screen.queryByRole("region", { name: "Ask next" })).not.toBeInTheDocument();
  });

  it("offers the near-miss team and asks the rewritten question", async () => {
    queryNlp
      .mockResolvedValueOnce({
        answer: "\u201cwas\u201d is also an everyday word, so it wasn't read as a team.",
        data: [],
        clarify: {
          prompt: "Did you mean the Washington Wizards?",
          action: "Yes, Wizards",
          question: "what was Wizards win rate",
        },
      })
      .mockResolvedValueOnce({ answer: "Washington Wizards are 20-21." });

    renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
      target: { value: "what was was win rate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await screen.findByText("Did you mean the Washington Wizards?");
    fireEvent.click(screen.getByRole("button", { name: "Yes, Wizards" }));
    await screen.findByText("Washington Wizards are 20-21.");
    expect(queryNlp).toHaveBeenLastCalledWith("what was Wizards win rate", "2025-26");
    expect(screen.getByRole("textbox", { name: "Question" })).toHaveValue(
      "what was Wizards win rate"
    );
  });

  it("clears the question box", () => {
    renderPage();
    const box = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(box, { target: { value: "Lakers record" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear question" }));
    expect(box).toHaveValue("");
  });

  it("shows the sentence alone when the rows only repeat it", async () => {
    queryNlp.mockResolvedValueOnce({
      answer: "The Warriors' payroll is $180,000,000 for 2025-26.",
      data: [{ abbreviation: "GSW", current_season_payroll: 180000000 }],
      show_data: false,
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Warriors payroll/i }));
    await screen.findByText("The Warriors' payroll is $180,000,000 for 2025-26.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("bolds the asked row of a split", async () => {
    queryNlp.mockResolvedValueOnce({
      answer: "The Wizards are 11-30 (.268) at home.",
      data: [
        { split: "Overall", wins: 18, losses: 64, win_pct: 0.22 },
        { split: "Home", wins: 11, losses: 30, win_pct: 0.268 },
        { split: "Away", wins: 7, losses: 34, win_pct: 0.171 },
      ],
      show_data: true,
      highlight_row: 1,
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Wizards' record at home/i }));
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    // The header, then Overall / Home / Away; only Home is bold.
    expect(rows.map((row) => row.className)).toEqual(["", "", "font-semibold", ""]);
    expect(within(rows[2]).getByText("11–30")).toBeInTheDocument();
    // The split column has no heading: the row labels say what it is.
    expect(within(rows[0]).getAllByRole("columnheader")[0]).toHaveTextContent("");
  });

  it("bolds only the key figure in the answer", async () => {
    queryNlp.mockResolvedValueOnce({
      answer: "Stephen Curry earns $62.6M in 2026-27.",
      value: "$62.6M",
      show_data: false,
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Curry's salary/i }));
    const figure = await screen.findByText("$62.6M");
    expect(figure.tagName).toBe("STRONG");
    expect(figure.parentElement).toHaveTextContent("Stephen Curry earns $62.6M in 2026-27.");
  });

  it("shows the plain sentence when the figure is not in it", async () => {
    queryNlp.mockResolvedValueOnce({
      answer: "No team is on a win streak yet.",
      value: "5 straight",
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /longest win streak/i }));
    await screen.findByText("No team is on a win streak yet.");
    expect(screen.queryByText("5 straight")).not.toBeInTheDocument();
  });
});
