---
name: nba-fact-check
description: Fact-check the time-sensitive NBA facts this repo hardcodes (salary cap, tax and apron figures, CBA apron restrictions, second-apron pick-freeze math, season and deadline dates, user-facing copy that states a rule or date) against current primary sources, and report what is stale. Use when the user asks whether cap/apron/tax numbers or league dates are still right, at a season rollover (new figures land July 1), around the trade deadline, or before shipping UI copy that states a league rule or date.
disable-model-invocation: true
---

# NBA fact-check

Baseline shows league rules and figures as if they were data, but several are hardcoded and go stale every season or every CBA. This skill finds them, checks each against current sources, and reports. It does not edit anything until the user approves the specific changes.

## 1. Collect the claims

Start from these known locations, then grep for anything new (`rg -n "apron|luxury tax|second apron|first-round|April|trade deadline|mid-level|MLE" services/frontend/src services/dbt/seeds docs`).

| Fact                                                       | Where it lives                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Salary cap, tax line, first and second apron per season    | `services/dbt/seeds/nba_cba_caps.csv` (one row per season; the seed's `.yml` documents it)                                                                                                                                |
| What each apron tier restricts                             | `services/frontend/src/lib/cba.ts`: `CAP_RESTRICTIONS`, `ALLOWED_BY_TIER`, and the header comment's sources                                                                                                               |
| Tax bill date and second-apron pick freeze                 | `capTimingNotes` in `cba.ts`. The frozen pick is the end year + 7 (2024-25 froze 2032). Re-check that offset, the "last day of the regular season" measurement, and the April month                                       |
| Playoffs card shows from April of the season's second year | `showsPlayoffs` in `services/frontend/src/lib/team-form.ts`                                                                                                                                                               |
| Play-in is seeds 7-10, playoff lock is seed 6              | `services/frontend/src/app/page.tsx` (`PLAYOFF_LOCK_SEED`), `standingsSeed` in `team-form.ts`                                                                                                                             |
| Copy that states a rule or date                            | `docs/data.md` (Upsets, Injuries), `docs/frontend.md`, `services/frontend/src/app/about/page.tsx` (the 12:00 UTC refresh time, shown in the reader's zone), cap-panel captions in `src/components/teams/cap-position.tsx` |

For the seed, check every season row, not just the newest: a past row can be wrong too. Also confirm that a row exists for the current season (`source.scrape_pipeline` / the newest season on the schedule). A missing row silently leaves the cap panel without thresholds.

## 2. Check each claim against sources

Use WebSearch (standard mode first; extended for anything recent or contested). Rank sources:

1. Primary: the NBA's own release (`pr.nba.com`, e.g. "NBA sets Salary Cap for 2026-27"), the CBA text, NBA.com operations pages.
2. Cap specialists: Spotrac, Hoops Rumors glossary, ESPN (Bobby Marks), The Athletic.
3. Everything else only to corroborate, never as the only source.

Rules:

- Two sources for anything you would change, at least one primary or specialist. One source is "unconfirmed", not "stale".
- Exact figures. Cap numbers are whole dollars in the seed (`164961000`), so compare to the dollar, not the rounded millions in a headline.
- Dates are relative to today. Say "measured on the last day of the 2026-27 regular season (scheduled for April 2027)", and check the actual scheduled date when it matters.
- Distinguish the rule from a team's situation. "Over the second apron freezes a pick" is a rule. "The Warriors are hard-capped" is a team fact that depends on transactions, which may not be confirmed. Report them separately.
- If a source contradicts the repo's data (for example a team reported hard-capped at an apron while Basketball-Reference payroll shows it over), report the conflict. Do not pick a side silently. BRef payroll lags signings and counts salary differently from the league.

## 3. Report

One table, then the proposed edits:

| Claim | Location (`file:line`) | Repo says | Sources say | Status |
| ----- | ---------------------- | --------- | ----------- | ------ |

Status is one of: Current, Stale (with the correct value), Unconfirmed (sources disagree or only one found), Missing (e.g. no seed row for the season).

Then list each proposed change as file + old → new, and end with a `Sources:` list of every URL used, as markdown links.

## 4. Apply (only after the user approves)

- Seed change: edit `nba_cba_caps.csv`. It reaches the API only after `dbt seed` + `dbt build` (or the daily refresh), so say so.
- `cba.ts` or `team-form.ts` change: update the matching tests (`tests/unit/cba.test.ts`, `cap-position.test.tsx`, `team-form.test.ts`) and run `npx vitest run` from `services/frontend`.
- Copy change: keep it short and plain (the user prefers smart brevity), with no operator jargon (`services/frontend/AGENTS.md`). Never call the odds line a "closing line"; it is a morning line.
- Doc change: no hard wrapping; one line per paragraph.
- Never commit; leave changes for the user to review.
