# 0002: The live model is chosen in Admin, never by the ml job

**Status:** Accepted. **Recorded:** 2026-11-16. Elo v1 was first promoted this way on 2026-10-05.

## Context

Several models score every game ([features/predictions.md](../features/predictions.md)) and the product shows one. Which one is a judgement call made on the comparison in Admin › Models, not something the scoring job should decide on its own.

## Decision

`source.model_artifacts.is_champion` is the only record of which model is live. It is set from Admin › Models (`PUT /api/v1/admin/models/champion`) and never by the ml job, which scores every model and leaves the choice alone. A fresh database starts on `elo-v0` (the migration seeds it).

## Consequences

- Promotion and rollback are one registry write plus a `dbt` rebuild; no backfill. The schedule shows the old model until the rebuild finishes.
- The API refuses to promote an unknown model (404) or one with no predictions (409).
- Product copy never hardcodes a model name; it reads the live model from the data.
