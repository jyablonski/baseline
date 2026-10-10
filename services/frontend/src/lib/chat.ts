/** Shown before anything has been asked. */
export const CHAT_STARTERS = [
  "Who leads the West?",
  "What is Curry's salary?",
  "How many back-to-backs has Kawhi Leonard played?",
];

// Suggested next questions, keyed by the tool the last answer came from.
// Fixed text rather than model-written: it costs nothing per answer, and each
// one is a question the tools are known to be able to answer. They lean on
// "he" and "they" because the conversation carries the subject.
const FOLLOW_UPS: Record<string, string[]> = {
  get_standings: ["And the other conference?", "Who has the best record overall?"],
  get_team_record: ["How about at home?", "And on the road?"],
  get_player_season_stats: ["How does that compare to last season?", "What is his salary?"],
  get_player_game_log: ["What are his season averages?", "How many back-to-backs has he played?"],
  get_career_stats: ["What are his averages this season?", "What is his salary?"],
  get_player_back_to_backs: ["What are his season averages?"],
  get_player_contract: ["What is his team's payroll?", "What are his season averages?"],
  get_team_payroll: ["What is their record?"],
  get_team_contracts: ["What is their payroll?", "What is their record?"],
  get_games_schedule: ["Who does the model favor in those games?"],
  get_game_predictions: ["What are the odds for those games?"],
  get_game_odds: ["Who does the model favor in those games?"],
};

/** "cube tool get_standings" -> "get_standings". */
function toolName(source: string | null | undefined) {
  return source?.replace(/^cube tool\s+/, "").trim() ?? "";
}

export function followUps(source: string | null | undefined): string[] {
  return FOLLOW_UPS[toolName(source)] ?? [];
}

/** A source a reader can make sense of: "cube tool get_team_record" -> "team record". */
export function sourceLabel(source: string | null | undefined) {
  return toolName(source).replace(/^get_/, "").replaceAll("_", " ");
}
