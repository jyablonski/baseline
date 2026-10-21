# Frontend

`services/frontend` is the Next.js app users see. It is a thin client: every screen goes through the FastAPI REST API.

It never talks to Postgres, Cube, or MCP. Keep it that way — see `services/frontend/AGENTS.md` for package-local rules.

## How it works

App Router, TanStack Query for fetches, UI in `src/components`, typed client in `src/lib/api.ts`.

URLs come from `NEXT_PUBLIC_API_URL`, which is a **build-time ARG**. It defaults to `http://localhost:8000`; production bakes the public origin into the image. An empty value must never fall through to localhost.

The product name is **Baseline**. One header bar holds the lockup, tabs, and a last-scraped watermark from `GET /api/v1/status` — never API health.

## Pages

Tabs: **Home · Schedule · Games · Players · Teams · Social · Ask** — the list in `src/lib/nav.ts`. About, Privacy, Terms and Contact are in the footer (`src/components/layout/footer.tsx`).

`/predictions`, `/players/compare`, and `/admin` are reachable routes with no tab of their own.

- `/` — the latest night's scores (six shown, the ones that matter most first: upsets by longest shot, then comebacks by deficit, then the closest finishes, with "See all N games →" to that night on `/games` when some are left out; each with its lead highlight, the market's favourite ("Market favored NYK 63%"; Baseline's model is not shown on the home page), an Upset tag when the market had the loser at 60% or better, and a Comeback tag when the winner trailed by 10 or more), full East/West standings, today's or the next games with national TV, and the day's top r/nba posts; each module links to its full page
- `/games` — finished games, the counterpart to `/schedule` (each links to the other in its intro). A day of results, opening on the newest day with a Final game (`?date=` for any other): a title ("Latest · Saturday, June 13"), a line with the shared stage and, for a lone series game, its number ("Finals · Game 5 · 1 game"), and a ← [date ▾] → picker whose arrows skip days off and whose month grid marks game days with dots. Each result reads winner first with logos, the margin, and the game's lead highlight, and links to its game page. Below, "Season notables" for the newest season with a finished game: Comebacks, Upsets (the morning line's win % with "1 in N", the no-vig price, records entering the game, notable absences), Closest games and Largest margins, every row with both teams' logos. Tab and team live in `?tab=` / `?team=`; a team reads each row from its side ("Blew it" / "Came back", "Upset win" / "Upset loss"). No season picker and no bars. Ten rows a page with ← Prev / Next →, ranks running on across pages. A Final game page's "← Games" link returns to that game's day; an upcoming one's goes to the schedule. Regular-season game pages have no recap headline (the scoreboard says it); playoff, Finals, Cup and Play-In games keep theirs
- `/games/[id]` — one page per game in any state, from `GET /api/v1/games/{id}`. A scoreboard header (logos, names, records, the score or the local tip time, and a meta line with the stage such as "NBA Finals, Game 5" or "Season opener"; records outside the regular season read "15–3 in playoffs"). Before the final: "Who wins?" pick cards with the consensus price and implied %, an optional stake row (locked at tip-off; signed-out cards lead to sign-in), a Before tip-off panel (form, model win %, the injury report as an expandable row, national TV), and the series panel. Once tipped and before the Final lands it says the score comes the morning after (no live data). Once Final: a headline from the series or the result ("Knicks win the NBA Finals, 4–1.") recap rows (standout from the lead highlight, a turning point from the flow and the same biggest run the chart shades, the losing side's top scorer), a "Before tip-off" bar with the market's and the model's favourite ("Market favored NYK 63%") and your graded pick (an "Upset" tag leads it when the market had the loser at 60% or better), whose Compare toggle opens one row each on a loser-to-winner axis with how each call came out, the flow chart with its facts beside the heading, the box score (one team at a time, winner first, a Shooting % toggle for the percentage columns, a team totals row), then the series panel (G1, G2… with W/L for a playoff series) beside This season (the other stages' records and the injury report). The Finals is a playoff series between conferences; any other is "Playoffs". Schedule rows, the home page's upcoming times, team calendar cells, and `/picks` rows link here. Team brand colors come from the API; not live win probability
- `/schedule` — upcoming slate (not Final, from the Eastern date three hours ago, so a late game stays on past midnight). No scores. Status reads "Live" for three hours from the scheduled tip and "Awaiting final" after that, by the clock alone (no live feed, so no score or game clock); a game with no tip time is never called live. From tip the pregame numbers dim and the pick cell locks: the side taken behind a lock icon, "vs" / "at" the opponent, and "Locked at tip" with the stake and what it wins (or "record only"), matching the API, which refuses picks from tip-off. A chip under the matchup names a notable player ruled out ("GSW: Stephen Curry out"); Day To Day gets none. Adds the champion model's pregame win % (away / home) and a sportsbook consensus moneyline with the home spread under it. Copy labels them as a model estimate and market odds, not betting advice. Any missing side renders `—`. Links to `/predictions`, and to `/games` for finished games
- `/predictions` — model scorecard: per season, each model's log loss, Brier, accuracy, and calibration error beside the sportsbook-market and always-pick-home baselines. The champion is marked "On schedule". Reached from `/schedule` and the game page, not the nav
- `/players`, `/players/[id]` — a Production vs Salary scatter (MVP score by salary; players coloured as MVP candidates, undervalued, overpaid, or average, with teams and players you can highlight) above the directory, which is ranked by Regular Season MVP score by default (name sort available), with search and filters; profile with an injury badge when listed, career bar and season MVP rank, game log with per-game MVP score, contract snapshot, B2B splits, PPG-by-season, and a Transactions table (linking the teams involved) shown only when the player has any
- `/players/compare` — up to N players, sortable, difference row, Regular Season and Playoff MVP score for the season. With exactly two, a head-to-head toggle shows games they played on opposite teams. Reached by selecting players on `/players`, not from the nav
- `/teams`, `/teams/[id]` — the standings: one table per conference ranked by seed (W-L, Win %, GB, Streak, L10), with a rule under the 6th seed (playoffs) and the 10th (play-in), then "Offense vs defense": each team's logo by points scored and allowed per game (up and right are better), league-average lines, the four quadrants named ("Good on both ends" tinted), dashed Net −10 / +10 lines, a Highlight picker that rings one team and dims the rest, and a tooltip with the team's record and its league rank on offense, defense and net; current season only, no previous-season fallback; no division view, since seeding is by conference. The home page's "Full standings →" lands here. Team profile with cap position (with a "When it counts" note for teams over the tax: the tax bill and the 2nd-apron pick freeze are judged on payroll at the end of the regular season, while apron limits apply to each transaction made while over; header KPIs show Play-in only for a team that played or is scheduled for it; Playoffs once there are playoff games or from April of the season's second year), the team's current injury report, the season calendar, and "Recent moves" (a table of the team's transactions — date, type, the move, and the players it names — ten at a time). The calendar is a month grid of the whole season from `GET /api/v1/teams/{id}/season-games`, opening on the month of the next game (or the last one once the season is over); played cells show W/L and the score, upcoming ones the local tip time and the team's model win %, B2B marks the second night of a back-to-back, and every game links to `/games/[id]`. Days are Eastern dates; the account time zone only moves the tip time. It is the only games view, on phones too
- `/ask` — posts to `POST /api/v1/query`. One question, one answer, no transcript. Shows what the engine matched ("Reading this as" chips, with links to team and player pages), one-click "Ask next" follow-ups, and a "Did you mean" card for a lowercase `was` / `min`. Try questions live in `src/lib/ask.ts`, kept in step with `ASK_SUGGESTIONS` in `services/api/tests/test_nl_eval.py`
- `/social` — r/nba feed, player mentions, and discourse leaderboards. See [social.md](social.md)
- `/about` — sources, coverage, and project background in plain language. Its copy is asserted em-dash-free by `tests/unit/about-page.test.tsx`
- `/admin` — operator console, GitHub OAuth. Not in the nav. See [operations.md](operations.md)

Season defaults to the latest loaded season everywhere; `?season=` is still honored but the picker is hidden.

Standings come from `fct_standings`: scraped values where they exist, otherwise derived in dbt from Regular Season Finals (`record_source` is `official` or `games`).

## Rules that keep being worth restating

**Honest empty states.** User-facing copy says "nothing to show yet" — never scrape CLI names, dbt, gold, make targets, or pipeline internals. Those belong in operator docs, not in front of a visitor.

**Salary is a snapshot.** Contract and payroll UI must be labeled a Basketball-Reference **remaining-year snapshot**, not a historical paid ledger. Unmatched names render `—`, never `$0` or an invented number.

**No new backends.** Do not add SQL, Cube, or MCP calls from the browser. `NLP_BACKEND=llm` is an API-side switch only.

**Nulls render `—`.** Including the watermark, which shows `Scraped —` when missing.

## Running and testing

```bash
cd services/frontend && npm install && npm run dev   # standalone
make up                                             # full stack with hot reload
make test-frontend                                  # Vitest
make test-frontend-e2e                              # Playwright
```

## Not built

Transactions have no page of their own, by design: they appear on team and player pages. Upsets have none either: they are a tab of the `/games` notables, on the game page and in `/picks`. Injuries have no page of their own: they appear on the game page, as a `/schedule` chip, on player pages, and on team pages.

Also not built: betting features, streaming Ask, live in-game win probability, a season-leaders API.
