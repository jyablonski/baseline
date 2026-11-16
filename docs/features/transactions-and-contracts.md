---
summary: Contracts and cap position (team Cap tab, player contract snapshot, salary on the value plot) and the transactions feed.
status: current
code:
  - services/scraper/src/scrapers/contracts.py
  - services/scraper/src/scrapers/contracts_parse.py
  - services/scraper/src/scrapers/transactions.py
  - services/scraper/src/scrapers/transactions_parse.py
  - services/dbt/models/marts/fct_player_contracts.*
  - services/dbt/models/marts/fct_team_payroll*
  - services/dbt/models/marts/fct_transactions.*
  - services/dbt/models/marts/fct_transaction_participants.*
  - services/dbt/models/intermediate/int_player_contracts_matched.*
  - services/dbt/models/intermediate/int_transactions_matched.*
  - services/api/src/routers/transactions.py
  - services/api/src/queries/transactions.py
  - services/frontend/src/components/teams/cap-position.tsx
  - services/frontend/src/components/transactions/transaction-list.tsx
  - services/frontend/src/lib/cba.ts
  - services/frontend/src/lib/transactions.ts
related:
  - docs/features/teams.md
  - docs/features/players.md
---

# Transactions and contracts

## What users see

- **Team page, Cap tab:** cap position against the cap, tax and aprons, with what each apron restricts, and a "When it counts" note for teams over the tax: the tax bill and the 2nd-apron pick freeze are judged on payroll at the end of the regular season, while apron limits apply to each transaction made while over.
- **Team page, Moves tab:** "Recent moves", a table of the team's transactions (date, type, the move, and the players it names), ten at a time.
- **Player page:** the remaining-contract snapshot (current salary and remaining guaranteed), and a Transactions table, shown only when the player has any.
- **`/players`:** salary on the Production vs Salary plot ([players.md](players.md)).

## How it works

- **Contracts:** `scrape-contracts` writes `source.player_contracts` and `source.team_payroll` from Basketball-Reference team contract pages. Contracts are matched to Baseline players in `int_player_contracts_matched`, and land as columns on `dim_players` (`current_season_salary`, `current_remaining_guaranteed`, `current_contract_season`) and `dim_teams` (payroll, plus the cap, tax and apron levels for that season from the `nba_cba_caps` seed). The apron rules shown on the Cap tab are a documented rule table in `lib/cba.ts`, not a warehouse fact.
- **Transactions:** `scrape-transactions` writes `source.transactions` and `source.transaction_participants`; `int_transactions_matched` resolves participants to Baseline players and teams.

Transactions are keyed by `sha256(transaction_date|description)`, so a reworded Basketball-Reference entry arrives as a new row rather than an edit. Draft picks are prose with no link on the source page and never become participants; a player named inside a pick clause is linked and is kept. A transaction naming a player that `scrape-players` has not seen yet drops that participant and picks it up on a later run — transactions reference players, they never create or reactivate them.

## Surfaces

- `GET /api/v1/transactions`: feeds team pages and player pages, as a table from one `TransactionList` component; not on the home page. Rows carry `linked_player_names`: only the players matched to a Baseline UUID, under Baseline's name.
- Contracts and payroll have no route of their own: they arrive as columns on `GET /api/v1/players/{id}`, `GET /api/v1/teams/{id}` and `GET /api/v1/players/value`.
- Cube `player_contracts`, `team_payroll`, `transactions`, `transaction_participants`; MCP `get_player_contract`, `get_team_payroll`, `get_team_contracts`, `get_transactions`, `get_transaction_participants`.

## Invariants

- **Link only `linked_player_names` and team abbreviations**, never the raw `player_names`.
- Salary and payroll are Basketball-Reference **remaining-year snapshots**, not a paid ledger or total earnings; copy says so.
- Transactions reference players; they never create or reactivate them.

## Gotchas

- `fct_team_payroll` is versioned: plain `ref('fct_team_payroll')` resolves to `latest_version` (1), and v2 builds to `gold.fct_team_payroll_v2` as a prerelease. Cube reads v1's relation, pinned in `exposures.yml`.
- The Cap tab's apron rules are a rule table, not a tax bill: repeater tax, exception dollar values and frozen-pick calendars are not modelled.

## Out of scope

A transactions page of its own (they live on team and player pages), a paid-salary ledger, and the repeater tax.
