# Frontend

`services/frontend` is the Next.js app users see. It is a thin client: every screen goes through the FastAPI REST API.

It never talks to Postgres, Cube, or MCP. Keep it that way — see `services/frontend/AGENTS.md` for package-local rules.

## How it works

App Router, TanStack Query for fetches, UI in `src/components`, typed client in `src/lib/api.ts`.

URLs come from `NEXT_PUBLIC_API_URL`, which is a **build-time ARG**. It defaults to `http://localhost:8000`; production bakes the public origin into the image. An empty value must never fall through to localhost.

The product name is **Baseline**. One header bar holds the lockup, tabs, and a last-scraped watermark from `GET /api/v1/status` — never API health.

## Pages

Tabs: **Home · Games · Teams · Players · Social · Ask** — the list in `src/lib/nav.ts`. About, Privacy, Terms and Contact are in the footer (`src/components/layout/footer.tsx`).

`/predictions`, `/players/compare`, and `/admin` are reachable routes with no tab of their own.

Each page's behaviour is documented with its feature:

| Route                                           | Doc                                                                                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`                                             | [Home](features/home.md)                                                                                                                                                                                                       |
| `/games`                                        | [Results and notables](features/results-and-notables.md), [Schedule](features/schedule.md), [Upsets](features/upsets.md)                                                                                                       |
| `/games/[id]`                                   | [Game page](features/game-page.md)                                                                                                                                                                                             |
| `/schedule`, `/past-games`                      | Redirect to `/games` ([Results and notables](features/results-and-notables.md))                                                                                                                                                |
| `/players`, `/players/[id]`, `/players/compare` | [Players and MVP score](features/players.md), [Player trends](features/player-trends.md)                                                                                                                                       |
| `/teams`, `/teams/[id]`                         | [Teams and standings](features/teams.md), [Team stats](features/team-stats.md)                                                                                                                                                 |
| `/predictions`                                  | [Predictions](features/predictions.md)                                                                                                                                                                                         |
| `/picks`                                        | [Picks](features/picks.md)                                                                                                                                                                                                     |
| `/ask`, `/chat`                                 | [Ask and Chat](features/ask-and-chat.md)                                                                                                                                                                                       |
| `/account`, `/signin`                           | [Accounts and follows](features/accounts-and-follows.md)                                                                                                                                                                       |
| `/social`                                       | [Social](features/social.md)                                                                                                                                                                                                   |
| `/feedback`                                     | [Feedback](features/feedback.md)                                                                                                                                                                                               |
| `/admin`                                        | [Admin and feature flags](features/admin.md)                                                                                                                                                                                   |
| `/about`                                        | Sources, the Data section (how data arrives, coverage, a link to `/data`), a link to `/feedback`, the developer and the build. Its copy is asserted em-dash-free by `tests/unit/about-page.test.tsx`                           |
| `/data`                                         | "About the data": the pipeline in five steps and how the derived numbers (TS%, implied win %, upsets, runs and comebacks) are computed, with the model scorecard and known limits. Linked from `/about`, not the nav or footer |

Season defaults to the latest loaded season everywhere; `?season=` is still honored but the picker is hidden.

## Rules that keep being worth restating

**Honest empty states.** User-facing copy says "nothing to show yet" — never scrape CLI names, dbt, gold, make targets, or pipeline internals. Those belong in operator docs, not in front of a visitor.

**Salary is a snapshot.** Contract and payroll UI must be labeled a Basketball-Reference **remaining-year snapshot**, not a historical paid ledger. Unmatched names render `—`, never `$0` or an invented number.

**No new backends.** Do not add SQL, Cube, or MCP calls from the browser. `NLP_BACKEND=llm` is an API-side switch only.

**Nulls render `—`.** Including the watermark, which shows `Data as of —` when missing.

## Running and testing

```bash
cd services/frontend && npm install && npm run dev   # standalone
make up                                             # full stack with hot reload
make test-frontend                                  # Vitest
make test-frontend-e2e                              # Playwright
```

## Not built

Transactions have no page of their own, by design: they appear on team and player pages. Upsets have none either: they are a tab of the `/games` notables, on the game page and in `/picks`. Injuries have no page of their own: they appear on the game page, as a chip on `/games`, on player pages, and on team pages.

Also not built: betting features, streaming Ask, live in-game win probability, a season-leaders API.
