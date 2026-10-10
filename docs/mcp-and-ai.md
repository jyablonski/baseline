# MCP

`services/mcp` exposes NBA analytics as MCP tools for LLM hosts like Claude Desktop, so an agent can query the warehouse without writing SQL.

It is a FastMCP server over the Cube semantic layer. Ask and the signed-in chat use the same named operations — see [ask.md](ask.md).

## One tool list, two surfaces

The tools are not defined in `services/mcp`. They live in `lib/baseline-analytics` (`baseline_analytics.tools`): one `ToolSpec` per tool, with its name, description, JSON-schema parameters, and handler. Two things read that list:

- **The MCP server** registers every entry with FastMCP, for outside clients such as Claude Desktop.
- **The API's LLM adapter** (`services/api/src/services/nlp/llm_tools.py`) sends the same entries to the model as function tools, for `/chat` and for `/ask` when `NLP_BACKEND=llm`. Chat withholds `get_reddit_posts`.

The API does not call the MCP server, and the model provider is never handed the MCP URL. The API runs each tool itself, in-process, so it can cap the rows the model sees, cap tool rounds, and show the rows under the answer. Both surfaces go through the same `CubeAnalytics` operations and the same Cube client in the same package, so a tool or filter added once reaches both.

## Running it

Local: stdio by default (`uv run src/server.py`). MCP starts with the default Compose stack; scraper and dbt stay in profile `tools`.

Production: Streamable HTTP behind Caddy at `https://<host>/mcp`, sharing the site certificate. Clients must send `Authorization: Bearer $MCP_API_TOKEN`, which is why the transport has to be TLS — the container port is not published.

Two separate secrets, easy to confuse:

- `MCP_API_TOKEN` authenticates a **client to MCP**
- `CUBEJS_API_SECRET` authenticates **MCP to Cube**

MCP never opens Postgres. Cube down means a clear tool error, never a gold-SQL fallback. Empty gold tables mean empty results — run scraper and dbt first.

## Tools

Player and career:

- `search_players` — fuzzy name search
- `get_player_game_log` — box scores, season optional
- `get_player_season_stats` — PPG/RPG/APG by season
- `get_career_stats`, `compare_players`
- `get_player_back_to_backs` — B2B splits vs overall
- `get_mvp_ladder` — Baseline MVP score ranking for a season; Regular Season (default) or Playoffs, latest scored season when omitted
- `get_player_mvp_scores` — one player's MVP score and rank by season, Regular Season and Playoffs as separate rows. The per-game score is `mvp_game_score` on `get_player_game_log`

Team and league:

- `get_team_record` — W/L plus filters (opponent, home/away, arena city, season). The game-by-game list is left out unless `include_games` is set
- `get_standings` — conference table with `streak`, `last_10`, and games back; falls back to Regular Season W–L when official rows are missing
- `get_team_payroll`, `get_player_contract` — remaining-year snapshots, not a paid ledger. Payroll is one team total with no players in it
- `get_team_contracts` — every contract on a team for one season, largest first (default: the current contract season)

Transactions:

- `get_transactions` — the Basketball-Reference log; optional season and description search
- `get_transaction_participants` — who moved. `direction` is `from`/`to` for teams, `none` for players, so a team on both sides of a trade appears twice

Games and feeds:

- `get_games_schedule` — games earliest first, upcoming scores null, with `national_tv` where ESPN lists a national broadcast. Filters: `team_abbreviation`, `opponent_abbreviation`, `location` (`home` / `away`, relative to the team), `status`, `season`, `from_date` / `to_date`, and `limit` (default 50, max 200). Unfiltered it is only the first 50 games, so always narrow it. There is no city filter: "Pistons in Chicago" is `team_abbreviation=DET`, `opponent_abbreviation=CHI`, `location=away`
- `get_game_predictions` — Elo pregame WP, not a betting line
- `get_play_by_play` — actions for one game
- `get_player_injuries` — current snapshot
- `get_game_odds` — lines for games that have not tipped; with `game_id`, that game's last pregame line even after it is played
- `get_biggest_upsets` — games the moneyline underdog won, most surprising first, with the model's view alongside. Empty until 2026-27 games with captured lines are Final; see [data.md](data.md#upsets)
- `get_daily_highlights` — what stood out on one day (default: the latest day with games), most notable first, one lead highlight per game; `all_candidates` adds the runners-up. See [data.md](data.md#daily-highlights)
- `get_reddit_posts` — r/nba posts; comments are reachable via `query_cube`

Escape hatch:

- `get_cube_schema` — measures and dimensions, with types and any member notes, for the cubes you name; with none, the list of cubes. Call it before `query_cube`
- `query_cube` — Cube query JSON (`measures`, `dimensions`, `filters`, `timeDimensions`, `order`, `limit`). Unknown members are rejected.

Every tool rejects an argument it does not declare instead of ignoring it, so a filter that does not exist is an error, never a quietly unfiltered result.

Free-form gold SQL (`query_nba_data`) was removed and is not coming back.

## Resources and prompts

- `nba://schema` — Cube meta, not gold DDL
- `nba://examples` — example questions mapped to tools
- Prompts: `analyze_player`, `compare_careers`, `team_performance`

## Adding a tool

Cube member → a query builder in `baseline_analytics/queries.py` → a method on `CubeAnalytics` in `operations.py` → a `ToolSpec` in `tools.py` (or just use `query_cube`). That one entry is what MCP and chat both serve; add an optional rules intent on `/ask` if the question should work without a model. Tests go in `lib/baseline-analytics/tests` (`make test-lib`).

A tool's description and parameters are sent to the model on every chat question, so keep them as short as they can be while still steering the model to the right filter. The same goes for what a tool returns: every row is re-sent on each later round of the same question, so give a tool a `limit` or leave bulky fields out by default.

### What a chat question costs

Each round-trip to the model carries the tool definitions (about 1,750 tokens), the instructions, and an index of cube names with a one-line description each (about 725 tokens together): roughly 2,500 tokens before the question and any rows. The full member list for all cubes, about 3,000 tokens, is deliberately not in the prompt; the model fetches members with `get_cube_schema` only when it needs `query_cube`. A question answered by one named tool is two round-trips, about 5,000 to 6,500 input tokens; a `query_cube` question adds a round. The provider caches the repeated prefix, so the second and later rounds are billed mostly at its cached rate. `source.chat_usage` records total input tokens and does not separate cached ones.

Do not add a gold-SQL helper to the API or MCP.

## Not built

Streaming, production LLM hardening, Cube SQL API and pre-aggregates, a historical paid-salary ledger, and a named `get_reddit_comments` tool.

Injuries, odds, PBP, Reddit, transactions, and Elo WP are queryable here but have no dedicated page in the UI.

Draft picks are prose on the transactions page with no link, so they are never participants. A player named inside a pick clause ("... was later selected") _is_ linked and is kept.
