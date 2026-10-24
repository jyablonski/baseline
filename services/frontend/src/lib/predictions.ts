import type { ScorecardRow } from "@/lib/types";

const MODEL_LABELS: Record<string, string> = {
  elo: "Elo",
  logit: "Logistic regression",
};

// Two versions of one model can grade side by side (elo-v0 / elo-v1), so the
// name alone is ambiguous. "elo-v1" -> "Elo v1".
export function modelLabel(row: Pick<ScorecardRow, "model_name" | "model_version">): string {
  const name = MODEL_LABELS[row.model_name] ?? row.model_name;
  const version = row.model_version.split("-").at(-1);
  return version && version !== row.model_version ? `${name} ${version}` : name;
}
