import { playerHref, teamHref } from "@/lib/nav";
import type { NlpEntity } from "@/lib/types";

/**
 * The /ask sidebar. Every question here is checked against the rules engine by
 * `test_ask_page_suggestions_are_answerable` in services/api/tests/test_nl_eval.py;
 * keep the two lists in step.
 */
export const ASK_SUGGESTIONS: { group: string; questions: string[] }[] = [
  {
    group: "Teams",
    questions: [
      "What is the Wizards' record at home?",
      "What is the Warriors' win percentage in Chicago?",
      "What is the Celtics' record against the Knicks?",
      "What is the Warriors payroll?",
    ],
  },
  {
    group: "Players",
    questions: [
      "What is Curry's salary?",
      "How many back-to-backs has Kawhi Leonard played?",
      "Compare LeBron James and Stephen Curry",
    ],
  },
  { group: "Games", questions: ["How many leads have the Lakers blown?"] },
  {
    group: "Standings",
    questions: ["Who leads the West?", "Which team has the longest win streak?"],
  },
];

const ENTITY_KIND_LABELS: Record<NlpEntity["kind"], string> = {
  team: "Team",
  opponent: "Opponent",
  player: "Player",
  city: "City",
  location: "Where",
  topic: "Topic",
};

export function entityKindLabel(kind: NlpEntity["kind"]) {
  return ENTITY_KIND_LABELS[kind];
}

/** Team and player entities carry full names, which the page routes slug. */
export function entityHref(entity: NlpEntity): string | null {
  if (entity.kind === "team" || entity.kind === "opponent") return teamHref(entity.label);
  if (entity.kind === "player") return playerHref(entity.label);
  return null;
}
