# 0008: Trends compare with the previous 20 games this season, and count a change only past the usual swings

**Status:** Accepted. **Decided:** 2026-11-16. Refines [0007](0007-trends-against-earlier-games.md).

## Context

A mock-up for the trends redesign proposed a baseline of each player's previous 20 games, reaching into last season when this season has fewer, so trends would show from opening week. It also proposed showing an arrow only when a change beats normal game-to-game noise, in place of fixed per-stat cutoffs and a guessed MVP threshold.

## Decision

- **The baseline is the up to `trend_baseline_games` (20) games before the last 10, this season only.** It never reaches into a previous season: that is the cross-season fallback [0001](0001-single-season.md) rules out, and production deletes the previous season, so those games would not exist there. Until a player has `trend_min_baseline_games` earlier games this season, the trend is hidden.
- **A stat's change counts only when it beats the player's usual swings**: Welch's z over the per-game values in both windows, at `trend_noise_z` (2.0). Only those changes get an arrow or a colour, and the same test on MVP game score decides up / down / steady.

## Consequences

- Trends stay blank for roughly the first two to three weeks of a season.
- `trend_mvp_threshold` is gone. At z = 2.0, on 2026-11-16 data, about a fifth of qualified players read up or down, and a player has 1–2 changed box stats on average.
- The team Overview tiles' Last 10 line compares with the season so far, with fixed cutoffs, because per-game team ratings that would allow the same test are not stored.
