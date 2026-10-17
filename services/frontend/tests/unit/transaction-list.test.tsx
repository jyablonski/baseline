import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listTransactions = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  api: { listTransactions: (...args: unknown[]) => listTransactions(...args) },
  queryErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

import { Providers } from "@/components/providers";
import { TransactionList } from "@/components/transactions/transaction-list";
import { transactionType } from "@/lib/transactions";

function transaction(index: number, overrides: Record<string, unknown> = {}) {
  return {
    transaction_key: `tx-${index}`,
    transaction_date: "2025-07-06",
    season: "2025-26",
    description: `The Golden State Warriors signed Player ${index}.`,
    team_count: 1,
    player_count: 1,
    source_url: "https://www.basketball-reference.com/leagues/NBA_2026_transactions.html",
    team_names: ["Golden State Warriors"],
    team_abbreviations: ["GSW"],
    player_names: [`Player ${index}`],
    linked_player_names: [],
    ...overrides,
  };
}

const page = (rows: unknown[], total: number, offset = 0) => ({
  data: rows,
  meta: { total, limit: 10, offset },
});

function renderList(props: Partial<Parameters<typeof TransactionList>[0]> = {}) {
  render(
    <Providers>
      <TransactionList title="Recent moves" {...props} />
    </Providers>
  );
}

beforeEach(() => {
  listTransactions.mockReset();
});

describe("TransactionList", () => {
  it("pages ten at a time and links only matched participants", async () => {
    const first = Array.from({ length: 10 }, (_, index) => transaction(index));
    first[0] = transaction(0, {
      description: "The Golden State Warriors traded Stephen Curry and a pick to the LA Clippers.",
      team_count: 2,
      team_abbreviations: ["GSW", "LAC"],
      player_names: ["Stephen Curry", "Unmatched Prospect"],
      linked_player_names: ["Stephen Curry"],
    });
    listTransactions
      .mockResolvedValueOnce(page(first, 12))
      .mockResolvedValueOnce(page([transaction(10), transaction(11)], 12, 10));
    renderList({ filter: { team_abbreviation: "GSW" } });

    const rows = await screen.findAllByTestId("transaction-row");
    expect(rows).toHaveLength(10);
    expect(listTransactions).toHaveBeenCalledWith({
      team_abbreviation: "GSW",
      limit: 10,
      offset: 0,
    });
    expect(rows[0]).toHaveTextContent("6 Jul 2025");
    expect(rows[0]).toHaveTextContent("Trade");
    // A team page links the players a move names, not the teams.
    expect(within(rows[0]).queryByRole("link", { name: "LAC" })).toBeNull();
    expect(within(rows[0]).getByRole("link", { name: "Stephen Curry" })).toHaveAttribute(
      "href",
      "/players/stephen-curry"
    );
    expect(within(rows[0]).queryByRole("link", { name: "Unmatched Prospect" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(
      await screen.findByText("The Golden State Warriors signed Player 11.")
    ).toBeInTheDocument();
    expect(listTransactions).toHaveBeenLastCalledWith({
      team_abbreviation: "GSW",
      limit: 10,
      offset: 10,
    });
    expect(screen.getAllByTestId("transaction-row")).toHaveLength(12);
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("links the teams instead on a player page", async () => {
    listTransactions.mockResolvedValue(
      page(
        [transaction(0, { team_abbreviations: ["GSW", "LAC"], linked_player_names: ["Player 0"] })],
        1
      )
    );
    renderList({ filter: { player_id: "p-1" }, links: "teams" });

    const [row] = await screen.findAllByTestId("transaction-row");
    expect(screen.getByRole("columnheader", { name: "Teams" })).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "LAC" })).toHaveAttribute("href", "/teams/lac");
    expect(within(row).queryByRole("link", { name: "Player 0" })).toBeNull();
  });

  it("says so when there is nothing on file", async () => {
    listTransactions.mockResolvedValue(page([], 0));
    renderList({ emptyMessage: "No moves on file for this team." });
    expect(await screen.findByText("No moves on file for this team.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent moves" })).toBeInTheDocument();
  });

  it("renders nothing at all when asked to hide an empty list", async () => {
    listTransactions.mockResolvedValue(page([], 0));
    renderList({ hideWhenEmpty: true });
    await vi.waitFor(() => expect(listTransactions).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Recent moves" })).not.toBeInTheDocument();
  });
});

describe("transactionType", () => {
  it("calls two teams a trade, and otherwise reads the verb", () => {
    expect(transactionType({ team_count: 2, description: "signed and traded" })).toBe("Trade");
    expect(transactionType({ team_count: 1, description: "The Bulls waived Jo Doe." })).toBe(
      "Waived"
    );
    expect(transactionType({ team_count: 1, description: "The Bulls released Jo Doe." })).toBe(
      "Released"
    );
    expect(transactionType({ team_count: 1, description: "The Bulls claimed Jo Doe." })).toBe(
      "Claimed"
    );
    expect(transactionType({ team_count: 1, description: "The Bulls signed Jo Doe." })).toBe(
      "Signed"
    );
    expect(transactionType({ team_count: 1, description: "The Bulls hired a coach." })).toBe(
      "Staff"
    );
    expect(transactionType({ team_count: 0, description: "Jo Doe retired." })).toBe("Move");
  });
});
