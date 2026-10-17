import type { Transaction } from "@/lib/types";

// The log has no type column, so this reads the prose. Two or more teams is a
// trade whatever the wording; the rest go by their verb.
const VERBS: [RegExp, string][] = [
  [/\bwaived\b/i, "Waived"],
  [/\breleased\b/i, "Released"],
  [/\bclaimed\b/i, "Claimed"],
  [/\bsigned\b/i, "Signed"],
  [/\bfired\b|\bhired\b|\bappointed\b/i, "Staff"],
];

export function transactionType(transaction: Pick<Transaction, "team_count" | "description">) {
  if (transaction.team_count >= 2) return "Trade";
  return VERBS.find(([pattern]) => pattern.test(transaction.description))?.[1] ?? "Move";
}
