# 0001: Only the current season is supported

**Status:** Accepted. **Recorded:** 2026-11-16 (the rule predates this record).

## Context

Production runs on one free-tier VM ([project_history.md](../project_history.md)), and the product is about the season being played. The original reasoning was not written down; this record states the rule as it is applied. Add the why here if it is recalled.

## Decision

Production loads the current (newest) NBA season only. Nothing in the product may depend on an earlier one.

- Every `season` / `since_season` parameter (API, `lib/baseline-analytics` tools, Cube filters, `?season=`) is plumbing that defaults to the current season.
- No season pickers, season-over-season comparisons, all-time or multi-season leaderboards, or historical backfills.
- SQL, dbt models and Cube queries resolve the season once (newest present) and filter to it. No cross-season fallbacks.
- "Career", "by season" and "history" in a name mean the loaded season ([glossary](../glossary.md)).

## Consequences

- Elo would reset at a season delete; `make ml-snapshot` keeps ratings across it ([ml.md](../ml.md)).
- `scrape-all --seasons`, `scripts/oracle-reset-and-backfill.sh` and `make ml-backfill` stay as maintenance tools for the current season only.
- A local database may still hold an older season, so local numbers that count "everything loaded" (a player's games on the season band) can look wrong where production would not.
