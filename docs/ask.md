# Ask

`POST /api/v1/query` is the only natural-language surface the browser touches. The `/ask` page posts here and nowhere else.

It answers from the warehouse through Cube. It is a bounded Q&A — one question, one answer, no stacked transcript.

## Backends

`NLP_BACKEND` picks the provider. Both go through Cube; neither writes or runs SQL.

| Backend             | Enable                                | Behavior                                                                                                                           |
| ------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **rules** (default) | `NLP_BACKEND=rules` or unset          | In-house regex/alias engine. No API key. Each matched family runs a Cube query.                                                    |
| **llm** (opt-in)    | `NLP_BACKEND=llm` + `NLP_LLM_API_KEY` | OpenAI-compatible chat with a tool loop over the same named Cube operations MCP uses. Missing key returns a refusal, not an error. |

Optional: `NLP_LLM_BASE_URL`, `NLP_LLM_MODEL` (default `https://api.openai.com/v1`, `gpt-4o-mini`), `NLP_LLM_MAX_OUTPUT_TOKENS` (default 2000, sent as `max_completion_tokens`), `NLP_LLM_REASONING_EFFORT` (unset, sent only when set). An unknown `NLP_BACKEND` fails at startup. The adapter speaks `/chat/completions` with function tools, and some models put conditions on that: `gpt-6-luna` rejects tool calls unless `NLP_LLM_REASONING_EFFORT=none`.

The signed-in `/chat` is a separate surface over the same adapter. It does not read `NLP_BACKEND`. It is offered only when `NLP_LLM_API_KEY` is set and the `chatbot` feature flag is on, behind sign-in and a per-user quota, and when it is offered it replaces Ask in the header: the site shows one or the other. The exact conditions, and when Chat itself answers from the rules engine, are in [operations.md](operations.md#chat-or-ask).

The tools the model is offered are the shared list in `lib/baseline-analytics` (`baseline_analytics.tools`), the same one the MCP server registers. The system prompt lists cubes by name only; the model calls `get_cube_schema` for a cube's members when it needs `query_cube`. See [mcp-and-ai.md](mcp-and-ai.md#one-tool-list-two-surfaces).

Do not enable `llm` on the public host without a key, spend controls, and a deliberate decision to send user questions to a third party.

## Requirements

Ask needs Cube (`CUBE_API_URL`, `http://cube:4000` in Compose). If Cube is down the endpoint returns a clear "semantic layer is down" message.

**There is no gold-SQL fallback**, by design. Don't add one.

## What rules can answer

Nine families: back-to-backs, season averages, player compare, team head-to-head (two teams named with "vs" or "against"), blown leads, arena-city records, salary/payroll, standings, and win streaks (the league's longest current win streak, or one named team's current streak, from the standings `streak` field).

Anything else returns a capability message with HTTP 200 — never a 501.

Rules answers also carry `entities` (what was matched: team, opponent, player, city, home/road, topic), `follow_ups` (questions built from those names, each checked to route back to the same team or player), and `clarify` (a "did you mean" with a rewritten question, offered when a lowercase `was` / `min` is the only team-like word). The LLM backend leaves all three empty. `show_data` is false when the sentence already says everything in `data` (one record, salary, payroll, back-to-backs, games back, one team's streak); the rows stay in the response for checking. Record questions return an Overall / Home / Away split (led by the city row when one is named) with `highlight_row` pointing at the asked row. Sentences and follow-ups use the short team name ("Wizards"), and follow-ups use the shortest player name that reads back as the same player ("Curry"); the entity chips and page links keep the full name. `value` is the key figure quoted from the sentence ("$62.6M", "11-30"), which the page sets in bold; money is rounded to millions. "at home" / "on the road" filter home or away games rather than a city.

Team names match whole words only, and the abbreviations `WAS` and `MIN` only when typed in capitals, so "what was" and "min" are not read as teams.

Season resolution: an explicit `YYYY-YY` (or `YYYY-YYYY`) in the question wins, otherwise the optional `season` field on the request body. Standings read `fct_standings`, which uses scraped standings where they exist and derives the rest from Regular Season Finals (`record_source` says which).

Salary and payroll answers are Basketball-Reference **remaining-year snapshots**, not a historical paid ledger.

## Adding a question type

1. Add or reuse a Cube measure/dimension over gold.
2. Optionally add a rules intent in `services/nl_query.py` that calls `CubeAnalytics`.
3. The same named operation is automatically available to MCP and the LLM backend.

Never add a gold-SQL string to the API or MCP.

## Where the code lives

- `cube/` — REST client, query builders, named operations
- `services/nl_query.py` — rules classification and prose
- `services/nlp/` — provider protocol, rules wrapper, LLM client and tools

The LLM backend gets a maximum of five tool rounds and cannot emit SQL. `query_cube` accepts Cube query JSON only, validated against Cube meta.

The `sql` field on a rules answer is a provenance string (`cube:…`), not something a client can run.

## Not built

Streaming replies, production LLM hardening (retries, rate limits, hosted eval), Cube SQL API or pre-aggregates, and "who wins tonight" (Elo is queryable via MCP, but there is no rules family and no UI badge).
