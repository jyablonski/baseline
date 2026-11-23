---
summary: A visitor's winner for each game with an optional stake, graded from gold, with no balance.
status: current
code:
  - services/frontend/src/app/picks/
  - services/frontend/src/components/account/pick-cell.tsx
  - services/frontend/src/components/account/settled-picks.tsx
  - services/frontend/src/components/games/result-row.tsx
  - services/frontend/src/components/games/game-pick.tsx
  - services/frontend/src/lib/picks.ts
  - services/api/src/routers/picks.py
  - services/api/src/queries/account.py
related:
  - docs/decisions/0003-no-pick-bankroll.md
  - docs/features/accounts-and-follows.md
  - docs/features/upsets.md
  - docs/features/predictions.md
  - docs/features/admin.md
---

# Picks

## What users see

- **`/games` and the game page:** a pick cell or "Who wins?" cards with the consensus price and implied %, and an optional stake. From tip the cell locks: the side taken behind a lock icon, "vs" / "at" the opponent, and "Locked at tip" with the stake and what it wins (or "record only"). Signed-out cards lead to sign-in.
- **Finished days on `/games`:** a right-hand cell on each result the visitor picked, "✓ You: DAL" (green) for a win or "✗ You: BOS" (red) for a loss, matched from the pick sheet by `game_id` ([results-and-notables.md](results-and-notables.md)).
- **`/picks`**, the signed-in visitor's sheet: four KPIs (record, net, vs. the model, best call), a Last 20 strip of W/L tiles, newest on the right, compared with the season once there are more than 20 graded picks, and Open picks folded behind a one-line count and first lock. Settled is a table (date, result, pick, final, stake, net; a whole row opens the game) with Last 7 days / Season, All / Wins / Losses, a Show model switch that adds the model's side and how it came out, and a team filter on the side picked. Breakdown lists the record and net of each split (favorites or underdogs, home or away, staked or record only, with or against the model); a chosen split or team becomes a chip, and the summary line over the table totals whatever is left. Filters are not kept in the URL.
- **Game page, once Final:** the visitor's graded pick on the Before tip-off bar.

## How it works

One pick per user and game, open until tip (or until the start of game day when no tip time is on file). Picking a winner is one click and counts toward the record. A stake is optional, in whole dollars from $1 to $1,000 (`MAX_STAKE`), and settles at the consensus moneyline stored with the pick when it was saved. There is no balance: nobody is given money to start with, a stake is not checked against anything, and the only money figure is the net of what settled stakes have won and lost, kept to the cent. It has no cash value. Picks are graded at read time from `gold.fct_games_schedule`, and compared with the champion model's favourite from `gold.fct_game_predictions` for the "vs. the model" figure: +1 where the pick won and the model's favourite lost, −1 the other way round. "Vs. the market" is wins less the wins the odds expected over settled picks that had a line: each pick carries `market_wp`, the picked side's no-vig consensus from the line `gold.fct_game_odds` keeps for the game (not the vigged price stored with the pick), and the expected count is their sum. Picks with no captured line count toward neither side, and `/picks` shows a dash until 10 priced picks have settled; the Breakdown shows the same figure per split. A won pick on a game the market underdog won (`gold.fct_game_upsets`) is tagged "Called the upset"; games with no captured pregame line are never tagged.

## Surfaces

- `GET /api/v1/account/picks`, `PUT` / `DELETE /api/v1/account/picks/{game_id}`, called only from server actions ([accounts-and-follows.md](accounts-and-follows.md)). Each pick carries `is_upset`.
- The `picks` feature flag ([admin.md](admin.md)): off hides picks and makes these routes return 503; existing picks are kept.

## Knobs

`MAX_STAKE` ($1,000 per pick); the `picks` flag.

## Invariants

- **No balance and no starting bankroll** ([0003](../decisions/0003-no-pick-bankroll.md)). It has no cash value.
- The API refuses a pick from tip-off; the UI only mirrors that.
- A stake settles at the price stored with the pick, but "vs. the market" uses the no-vig consensus, not that stored price.

## Gotchas

- A game with no tip time on file locks at the start of game day.
- Picks with no captured line count toward neither side of "vs. the market" and are never tagged as upsets.
- A pick sheet that fails for any reason other than a stale session is reported on `/games` rather than silently dropping the pick column.

## Out of scope

A balance, prizes or transfers between users, and the pick leaderboard (planned; not until there are users).
