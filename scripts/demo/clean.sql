-- Remove every row scripts/demo/seed.sql inserted. Local only; see `make seed-demo-clean`.
-- Markers: demo game ids start with 0000de30-, demo odds events with demo-.
-- Backfilled Elo predictions on real Finals are real data and are kept.
BEGIN;

DELETE FROM source.game_predictions
WHERE game_id::text LIKE '0000de30-%';

DELETE FROM source.game_odds
WHERE
    odds_event_id LIKE 'demo-%'
    OR game_id::text LIKE '0000de30-%';

DELETE FROM source.games WHERE game_id::text LIKE '0000de30-%';

COMMIT;
