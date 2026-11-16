# 0003: Picks have no starting bankroll or balance

**Status:** Accepted. **Recorded:** 2026-11-16.

## Context

Picks carry an optional dollar stake settled at the consensus moneyline. An earlier plan (`docs/plans/2026-10/chatbot-and-accounts.md`) described play money with a running balance; the build dropped the balance. The reason was not written down; add it here if it is recalled.

## Decision

There is no balance. Accounts start at nothing, a stake is not checked against anything, and the only money figure is the net of settled stakes. It has no cash value. Do not add a starting bankroll.

## Consequences

- A stake is bounded only by `MAX_STAKE` ($1,000) per pick.
- The pick leaderboard is planned but not built until there are users.
