# 0004: Odds and injuries are captured once a day

**Status:** Accepted. **Decided:** 2026-11-01.

## Context

The Odds API costs credits per call, and keeping more than one line per game needs a history table. Hourly injury captures were proposed alongside more odds pulls.

## Decision

The odds scrape stays daily (the morning line). No hourly or pre-tip odds pulls. Injury capture also stays daily, as part of the morning run; an hourly capture is deferred, not rejected.

## Consequences

- `source.game_odds` keeps only the latest row per event, so closing line value cannot be measured. Value work uses the morning line and the slope in `make ml-value` ([ml.md](../ml.md)).
- Injury features see the morning report only: late scratches and returns are a known blind spot for Elo v2 / v3 and the game page.
