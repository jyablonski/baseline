# Ask

`POST /api/v1/query` is the only natural-language surface the browser touches. The `/ask` page posts here and nowhere else.

It answers from the warehouse through Cube. It is a bounded Q&A — one question, one answer, no stacked transcript.

## Backends

`NLP_BACKEND` picks the provider. Both go through Cube; neither writes or runs SQL.

| Backend             | Enable                                | Behavior                                                                                                                           |
| ------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **rules** (default) | `NLP_BACKEND=rules` or unset          | In-house regex/alias engine. No API key. Each matched family runs a Cube query.                                                    |
| **llm** (opt-in)    | `NLP_BACKEND=llm` + `NLP_LLM_API_KEY` | OpenAI-compatible chat with a tool loop over the same named Cube operations MCP uses. Missing key returns a refusal, not an error. |

Optional: `NLP_LLM_BASE_URL`, `NLP_LLM_MODEL` (default `https://api.openai.com/v1`, `gpt-4o-mini`). An unknown `NLP_BACKEND` fails at startup.

Do not enable `llm` on the public host without a key, spend controls, and a deliberate decision to send user questions to a third party.

## Requirements

Ask needs Cube (`CUBE_API_URL`, `http://cube:4000` in Compose). If Cube is down the endpoint returns a clear "semantic layer is down" message.

**There is no gold-SQL fallback**, by design. Don't add one.

## What rules can answer

Eight families: back-to-backs, season averages, player compare, team head-to-head (two teams named), blown leads, arena-city records, salary/payroll, and standings.

Anything else returns a capability message with HTTP 200 — never a 501.

Season resolution: an explicit `YYYY-YY` in the question wins, otherwise the optional `season` field on the request body. Standings prefer official `fct_standings` and fall back to Regular Season W–L when those rows are missing.

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

The LLM backend gets a maximum of four tool rounds and cannot emit SQL. `query_cube` accepts Cube query JSON only, validated against Cube meta.

The `sql` field on a rules answer is a provenance string (`cube:…`), not something a client can run.

## Not built

Streaming replies, production LLM hardening (retries, rate limits, hosted eval), Cube SQL API or pre-aggregates, and "who wins tonight" (Elo is queryable via MCP, but there is no rules family and no UI badge).
