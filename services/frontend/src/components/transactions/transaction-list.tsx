"use client";

import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";

import { ErrorState, LoadingState } from "@/components/query-state";
import { api, queryErrorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { playerHref, teamHref } from "@/lib/nav";
import { transactionType } from "@/lib/transactions";
import type { Transaction } from "@/lib/types";

const PAGE_SIZE = 10;

type Filter = { team_abbreviation?: string; player_id?: string };

/**
 * Newest transactions first, ten at a time, as one table row each. Team pages
 * link the players a move names; player pages link the teams.
 */
export function TransactionList({
  title,
  filter = {},
  links = "players",
  emptyMessage,
  hideWhenEmpty = false,
}: {
  title: string;
  filter?: Filter;
  links?: "players" | "teams";
  emptyMessage?: string;
  /** Render nothing at all, heading included, when there are no transactions. */
  hideWhenEmpty?: boolean;
}) {
  const query = useInfiniteQuery({
    queryKey: ["transactions", filter],
    queryFn: ({ pageParam }) =>
      api.listTransactions({ ...filter, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.meta.offset + last.data.length;
      return last.data.length > 0 && next < last.meta.total ? next : undefined;
    },
  });
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  if (hideWhenEmpty && (query.isPending || query.isError || rows.length === 0)) return null;

  return (
    <section aria-label={title}>
      <h2 className="type-module border-b border-rule-strong pb-2">{title}</h2>
      {query.isPending ? (
        <LoadingState label="Loading transactions…" />
      ) : query.isError ? (
        <ErrorState message={queryErrorMessage(query.error)} />
      ) : rows.length === 0 ? (
        <p className="py-3 text-sm text-ink-2">{emptyMessage ?? "No transactions on file."}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-28">Date</th>
                  <th className="w-24">Type</th>
                  <th>Move</th>
                  <th className="w-48">{links === "players" ? "Players" : "Teams"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <TransactionRow key={row.transaction_key} transaction={row} links={links} />
                ))}
              </tbody>
            </table>
          </div>
          {query.hasNextPage ? (
            <button
              type="button"
              className="btn-ghost mt-2"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? "Loading…" : "Show more"}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function TransactionRow({
  transaction,
  links,
}: {
  transaction: Transaction;
  links: "players" | "teams";
}) {
  const named =
    links === "players"
      ? transaction.linked_player_names.map((name) => ({ href: playerHref(name), label: name }))
      : transaction.team_abbreviations.map((abbreviation) => ({
          href: teamHref(abbreviation),
          label: abbreviation,
        }));
  return (
    <tr data-testid="transaction-row">
      <td className="tabular whitespace-nowrap text-ink-2">
        {formatDate(transaction.transaction_date)}
      </td>
      <td className="whitespace-nowrap text-ink-2">{transactionType(transaction)}</td>
      {/* Free prose from the source: rendered as text, never as markup. */}
      <td>{transaction.description}</td>
      <td>
        {named.length === 0
          ? "—"
          : named.map((link, index) => (
              <span key={link.href}>
                {index > 0 ? ", " : null}
                <Link href={link.href} className="text-primary hover:underline">
                  {link.label}
                </Link>
              </span>
            ))}
      </td>
    </tr>
  );
}
