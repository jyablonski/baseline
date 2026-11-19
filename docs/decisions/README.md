# Decisions

Short records of choices made on purpose, so nobody (person or agent) "fixes" them. One file per decision, numbered in the order they were recorded. Plans in `docs/plans/` are local scratch and gitignored; when a plan settles something durable, write it down here.

Each record has a status (`Accepted`, or `Superseded by NNNN`), the date it was decided where known, then Context, Decision and Consequences. Don't rewrite an accepted record to change it: add a new one that supersedes it.

| #                                            | Decision                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [0001](0001-single-season.md)                | Only the current season is loaded and supported                                                      |
| [0002](0002-champion-set-by-admin.md)        | The live model is chosen in Admin, never by the ml job                                               |
| [0003](0003-no-pick-bankroll.md)             | Picks have no starting bankroll or balance                                                           |
| [0004](0004-ingest-cadence-daily.md)         | Odds and injuries are captured once a day                                                            |
| [0005](0005-no-follow-modules-on-hubs.md)    | No followed-team module on the home page or `/teams`                                                 |
| [0006](0006-ask-rules-backend-default.md)    | Ask runs on the rules backend; the LLM path stays off                                                |
| [0007](0007-trends-against-earlier-games.md) | Player trends compare the last 10 with the games before them                                         |
| [0008](0008-trend-baseline-and-noise.md)     | Trends compare with the previous 20 games this season, and count a change only past the usual swings |
| [0009](0009-active-means-on-a-roster.md)     | A player is active, and on a team, only as a current roster says                                     |
