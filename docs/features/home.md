---
summary: The home page — last night's results that mattered, standings, the next slate, and r/nba.
status: current
code:
  - services/frontend/src/app/page.tsx
  - services/frontend/src/components/layout/refresh-time.tsx
  - services/api/src/routers/status.py
  - services/api/src/queries/status.py
related:
  - docs/features/results-and-notables.md
  - docs/features/daily-highlights.md
  - docs/features/upsets.md
  - docs/features/accounts-and-follows.md
  - docs/decisions/0005-no-follow-modules-on-hubs.md
---

# Home

## What users see

- **The latest night's scores:** six shown, in as many columns as fit the count so a short night fills the row, the ones that matter most first: upsets by longest shot, then comebacks by deficit, then the closest finishes. Each carries its lead highlight, the market's favourite ("Market favored NYK 63%"), an Upset tag when the market had the loser at 60% or better, and a Comeback tag when the winner trailed by 10 or more.
- **Full East/West standings.**
- **Today's or the next games** with national TV under a "Sat 24 Oct · 8 games · PDT" caption. Streaks and back-to-backs are left to `/schedule` and the game page.
- **The day's top r/nba posts.**
- Each module heads with a link to its page at its top right ("See all latest results →", pinned to that night, "See full schedule →", "Teams →", "Social →"); the rail's date caption sits on its own line under the title so the link never wraps.
- The page ends in a **"Data as of …"** stamp.
- **Followed teams** add no module here: their games always make the capped results and upcoming lists, and their games and standings rows are tinted.

## Surfaces

`GET /api/v1/games` (results and `lead_highlight`), `GET /api/v1/standings`, `GET /api/v1/schedule`, `GET /api/v1/social/posts`, and `GET /api/v1/status` for the stamp: `last_scraped_at` from `source.scrape_pipeline.last_success_at` plus warehouse coverage counts.

## Invariants

- **Baseline's model is not shown on the home page**, only the market's favourite.
- **No followed-team module** on the home page ([0005](../decisions/0005-no-follow-modules-on-hubs.md)).
- Never surface `GET /health` (liveness only) in the UI; the stamp reads `GET /api/v1/status`.

## Out of scope

Personal modules, model numbers, and streaks or back-to-backs on the slate.
