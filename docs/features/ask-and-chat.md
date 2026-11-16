---
summary: Questions about the data — Ask (rules, public) and Chat (LLM, signed in, behind a flag); one is shown, never both.
status: current
code:
  - services/frontend/src/app/ask/
  - services/frontend/src/app/chat/
  - services/frontend/src/lib/ask.ts
  - services/frontend/src/lib/ask-table.ts
  - services/frontend/src/lib/chat.ts
  - services/frontend/src/components/account/when-chatbot.tsx
  - services/api/src/routers/query.py
  - services/api/src/routers/chat.py
  - services/api/src/services/
  - lib/baseline-analytics/src/baseline_analytics/
related:
  - docs/decisions/0006-ask-rules-backend-default.md
  - docs/mcp-and-ai.md
  - docs/cube.md
  - docs/features/admin.md
---

# Ask and Chat

`POST /api/v1/query` is the only natural-language surface the browser touches without signing in. It answers from the warehouse through Cube: one question, one answer, no stacked transcript.

## What users see

- **`/ask`** posts to `POST /api/v1/query`. One question, one answer, no transcript. Shows what the engine matched ("Reading this as" chips, with links to team and player pages), one-click "Ask next" follow-ups, and a "Did you mean" card for a lowercase `was` / `min`. Try questions live in `src/lib/ask.ts`, kept in step with `ASK_SUGGESTIONS` in `services/api/tests/test_nl_eval.py`.
- **`/chat`**, signed in: a multi-turn conversation answered through the named Cube tools, with fixed follow-up suggestions per tool. Plain text; Markdown is not rendered.
- The header shows **either Chat or Ask, never both** (below).

## Backends

`NLP_BACKEND` picks the provider. Both go through Cube; neither writes or runs SQL.

| Backend             | Enable                                | Behavior                                                                                                                           |
| ------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **rules** (default) | `NLP_BACKEND=rules` or unset          | In-house regex/alias engine. No API key. Each matched family runs a Cube query.                                                    |
| **llm** (opt-in)    | `NLP_BACKEND=llm` + `NLP_LLM_API_KEY` | OpenAI-compatible chat with a tool loop over the same named Cube operations MCP uses. Missing key returns a refusal, not an error. |

Optional: `NLP_LLM_BASE_URL`, `NLP_LLM_MODEL` (default `https://api.openai.com/v1`, `gpt-4o-mini`), `NLP_LLM_MAX_OUTPUT_TOKENS` (default 2000, sent as `max_completion_tokens`), `NLP_LLM_REASONING_EFFORT` (unset, sent only when set). An unknown `NLP_BACKEND` fails at startup. The adapter speaks `/chat/completions` with function tools, and some models put conditions on that: `gpt-6-luna` rejects tool calls unless `NLP_LLM_REASONING_EFFORT=none`.

The signed-in `/chat` is a separate surface over the same adapter. It does not read `NLP_BACKEND`. It is offered only when `NLP_LLM_API_KEY` is set and the `chatbot` feature flag is on, behind sign-in and a per-user quota, and when it is offered it replaces Ask in the header: the site shows one or the other. The exact conditions, and when Chat itself answers from the rules engine, are in [Chat or Ask](#chat-or-ask) below.

The tools the model is offered are the shared list in `lib/baseline-analytics` (`baseline_analytics.tools`), the same one the MCP server registers. The system prompt lists cubes by name only; the model calls `get_cube_schema` for a cube's members when it needs `query_cube`. See [mcp-and-ai.md](../mcp-and-ai.md#one-tool-list-two-surfaces).

Do not enable `llm` on the public host without a key, spend controls, and a deliberate decision to send user questions to a third party.

## Requirements

Ask needs Cube (`CUBE_API_URL`, `http://cube:4000` in Compose). If Cube is down the endpoint returns a clear "semantic layer is down" message.

**There is no gold-SQL fallback**, by design. Don't add one.

## What rules can answer

Nine families: back-to-backs, season averages, player compare, team head-to-head (two teams named with "vs" or "against"), blown leads and comebacks, arena-city records, salary/payroll, standings, and win streaks (the league's longest current win streak, or one named team's current streak, from the standings `streak` field).

Anything else returns a capability message with HTTP 200 — never a 501.

Rules answers also carry `entities` (what was matched: team, opponent, player, city, home/road, topic), `follow_ups` (questions built from those names, each checked to route back to the same team or player), and `clarify` (a "did you mean" with a rewritten question, offered when a lowercase `was` / `min` is the only team-like word). The LLM backend leaves all three empty. `show_data` is false when the sentence already says everything in `data` (one record, salary, payroll, back-to-backs, games back, one team's streak); the rows stay in the response for checking. Record questions return an Overall / Home / Away split (led by the city row when one is named) with `highlight_row` pointing at the asked row. Sentences and follow-ups use the short team name ("Wizards"), and follow-ups use the shortest player name that reads back as the same player ("Curry"); the entity chips and page links keep the full name. `value` is the key figure quoted from the sentence ("$62.6M", "11-30"), which the page sets in bold; money is rounded to millions. "at home" / "on the road" filter home or away games rather than a city.

Blown leads and comebacks are one family over Cube `team_game_flow`. "Blown" / "blew a lead" leads with the losses after holding a lead; "comeback", "come back from", "rallied from", "overcame" lead with the wins after trailing, and both sides are always answered. The default threshold is the cube's 10 points; a margin in the question ("by 20", "of 15", "from 18 down", "15+", "20 or more", "a 12-point lead") reads that team's qualifying games instead and lists the biggest three with date and opponent. A season label such as `2025-26` is never read as a margin.

Team names match whole words only, and the abbreviations `WAS` and `MIN` only when typed in capitals, so "what was" and "min" are not read as teams.

Season resolution: an explicit `YYYY-YY` (or `YYYY-YYYY`) in the question wins, otherwise the optional `season` field on the request body. Standings read `fct_standings`, which uses scraped standings where they exist and derives the rest from Regular Season Finals (`record_source` says which).

Salary and payroll answers are Basketball-Reference **remaining-year snapshots**, not a historical paid ledger.

## Adding a question type

1. Add or reuse a Cube measure/dimension over gold.
2. Optionally add a rules intent in `services/nl_query.py` that calls `CubeAnalytics`.
3. The same named operation is automatically available to MCP and the LLM backend.

Never add a gold-SQL string to the API or MCP.

## Where the code lives

- `lib/baseline-analytics` — Cube client, query builders, named operations, and the shared tool list
- `services/api/src/services/nl_query.py` — rules classification and prose
- `services/api/src/services/nlp/` — provider protocol, rules wrapper, LLM client and tools

The LLM backend gets a maximum of five tool rounds and cannot emit SQL. `query_cube` accepts Cube query JSON only, validated against Cube meta.

The `sql` field on a rules answer is a provenance string (`cube:…`), not something a client can run.

## Chat or Ask

The header has one tab for questions, never both. Which one it is, and what answers a question once you are in Chat, are two separate decisions.

**1. Which tab the site shows.** The header shows **Chat** only when `GET /api/v1/features` reports `chatbot: true`, and that takes both of these:

- the `chatbot` flag is on in `source.feature_flags` (the migration creates it on; `/admin` toggles it), and
- `NLP_LLM_API_KEY` is set to a non-empty value on the API.

If either is missing, or the features request fails or has not loaded yet, the header shows **Ask**. `NLP_BACKEND` plays no part in this: it only chooses the engine behind `/ask`. `/ask` stays reachable by URL either way, and the Chat page links to it when chat is unavailable.

**2. Whether a visitor can use Chat.** Showing the tab is not enough. A question is refused, with nothing sent to the model, when:

| Condition                                                                     | Result                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------- |
| `ACCOUNTS_API_TOKEN` unset                                                    | 503, accounts unavailable (sign-in still works) |
| Not signed in                                                                 | the page asks them to sign in                   |
| `chatbot` flag switched off after the page loaded                             | 503, "Chat is turned off right now"             |
| Their `CHAT_DAILY_LIMIT` is spent, or one of their questions is still running | 429 / 409                                       |
| The conversation already holds `CHAT_MAX_TURNS` questions                     | 400, start a new conversation                   |

**3. What answers inside Chat.** Chat stays in the header, but one question at a time it can fall back to the same rules engine Ask uses:

| Situation                                                                                  | Answered by                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key set, and fewer than `CHAT_GLOBAL_DAILY_LIMIT` model-backed questions today (all users) | the model, through the named Cube tools                                                                                                                                                 |
| `CHAT_GLOBAL_DAILY_LIMIT` reached                                                          | the rules engine, for everyone, until midnight Eastern                                                                                                                                  |
| The model call fails or times out                                                          | nobody: 502, "The answer service did not respond" (no silent fallback)                                                                                                                  |
| Cube is down                                                                               | nobody. On the rules engine the reply says the semantic layer is down; on the model path it is the fixed "I don't have that", because a reply with no rows behind it is always replaced |

Each row in `source.chat_usage` records which one answered in `backend` (`llm` or `rules`).

## Chat limits and logging

**Chat.** `CHAT_DAILY_LIMIT` questions per user per Eastern day (default 10), `CHAT_MAX_TURNS` questions per conversation (default 6), one in-flight question per user. Every ask is a row in `source.chat_usage` with its backend, model, token counts, tool rounds, outcome, and latency; the text of the question is not stored. Chat answers through the same OpenAI-compatible adapter `/ask` uses (`NLP_LLM_BASE_URL`, `NLP_LLM_MODEL`); when it is offered and when it falls back to the rules engine is set out under [Chat or Ask](#chat-or-ask) above (`CHAT_GLOBAL_DAILY_LIMIT` defaults to 250). The model is offered the shared named tools from `lib/baseline-analytics` minus the Reddit one, is told today's date, sees at most `CHAT_MODEL_ROW_CAP` rows of a result, and a reply with no rows behind it is replaced by a fixed "I don't have that". Answers are plain text; the page does not render Markdown. The suggested follow-up questions under an answer are fixed text per tool (`services/frontend/src/lib/chat.ts`), not model output.

## Invariants

- **No gold-SQL fallback**, and neither backend writes or runs SQL. `query_cube` is Cube query JSON only.
- Tools are added or changed only in `lib/baseline-analytics` (`tools.py`), never in `services/api` or `services/mcp`.
- The rules backend is the public default; the LLM path is opt-in and off in production ([0006](../decisions/0006-ask-rules-backend-default.md)).
- Cube down gives a clear error on Ask and MCP, never a fallback.

## Out of scope

Streaming replies, production LLM hardening (retries, rate limits, hosted eval), Cube SQL API or pre-aggregates, and "who wins tonight" (Elo is queryable via MCP, but there is no rules family and no UI badge).
