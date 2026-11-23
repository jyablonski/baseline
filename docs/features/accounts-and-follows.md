---
summary: Sign-in, accounts, time zones, and followed teams.
status: current
code:
  - services/frontend/src/app/account/
  - services/frontend/src/app/signin/
  - services/frontend/src/components/account/
  - services/frontend/src/lib/account.ts
  - services/frontend/src/lib/account-api.ts
  - services/frontend/src/lib/follows.ts
  - services/frontend/src/lib/timezones.ts
  - services/api/src/routers/account.py
  - services/api/src/queries/account.py
related:
  - docs/decisions/0005-no-follow-modules-on-hubs.md
  - docs/features/picks.md
  - docs/features/ask-and-chat.md
  - docs/features/admin.md
---

# Accounts and follows

## What users see

- **`/signin`:** GitHub or Google.
- **`/account`:** the time zone, and "Teams you follow": a search box (city, name or abbreviation) to add, the numbered list with up/down arrows that set the order of the header shortcuts, and Unfollow. A user can delete their own account, with its picks and usage rows, from here.
- **Team pages:** a Follow / "Following ✓" button beside the name, or "Sign in to follow" when signed out.
- **Following a team** puts its logo in every page's header in the chosen order, linking to its team page (in the mobile menu too); keeps its games in the home page's capped lists and tints them and its standings rows there and on `/teams`; tints its rows on `/games`; and offers `?mine=1` there to show only followed teams' games, past and upcoming.

## How it works

Sign-in is open to anyone and is needed only for `/chat`, picks and following teams. User data lives in `source.users`, `source.chat_usage`, `source.picks` and `source.user_follows` (Alembic-owned, written by the API, never read by dbt or Cube). No email is stored; an account is identified by the provider and the provider's account id. An account may choose a time zone on `/account` (`users.timezone`, one of a fixed list the API validates; null is Eastern), which shifts game start times on the schedule, picks, team and home pages for that user only. Stored times and every date boundary stay Eastern. An account may also follow up to `FOLLOW_MAX_TEAMS` teams (default 5) from a team page: `source.user_follows` holds the team's Baseline UUID, checked against `gold.dim_teams` when it is written, so it survives dbt rebuilds. `user_follows.position` is the order the account sets on `/account`; a new follow goes last, and a reorder must name every followed team (409 otherwise). Following puts each team's logo in the header in that order, linking to its team page, keeps those teams' games in the home page's capped lists and tints them and their standings rows there and on `/teams`, tints their rows on `/games`, and offers `?mine=1` there to show only their games, past and upcoming. The table also allows players, which are not offered yet.

The browser never calls `/api/v1/account/*`. A Next.js server action checks the session, then calls the API with `Authorization: Bearer $ACCOUNTS_API_TOKEN` and the caller's internal id in `X-Baseline-User`. The token is the only reason the API believes that header, so it is separate from `ADMIN_API_TOKEN`, server-side only, and unset returns 503. With it unset sign-in and `/admin` still work; chat and picks report that accounts are unavailable.

**Stale sessions.** A session cookie carries the account id. If the API no longer has that row (the account was deleted from another device, or the table was rebuilt), the first call returns 404; the server action then re-registers the same provider identity, rewrites the cookie, and retries once. The visitor sees nothing. A pick sheet that fails for any other reason is reported on `/games` rather than silently dropping the pick column.

## Surfaces

`/api/v1/account/*`, never called by a browser: `POST /account/users` (register a provider identity), `GET /account/me` (with `follows` in order), `PUT /account/me/timezone`, `PUT` / `DELETE /account/me/follows/team/{team_id}`, `PUT /account/me/follows/team` with every followed id to set the order, `DELETE /account/me`, plus chat ([ask-and-chat.md](ask-and-chat.md)) and picks ([picks.md](picks.md)).

## Knobs

`FOLLOW_MAX_TEAMS` (default 5). `ACCOUNTS_API_TOKEN` must be set for any of it to work.

## Invariants

- **A session is not authority.** Sign-in is open to anyone; the admin check is separate ([admin.md](admin.md)).
- **No Next.js route handlers under `/api/*`**: Caddy sends everything there except `/api/auth/*` to FastAPI. Use server actions.
- No email is stored.
- Stored times and every date boundary stay Eastern; the time zone moves only displayed tip times.
- Followed teams personalise existing surfaces; no followed-team module on the home page or `/teams` ([0005](../decisions/0005-no-follow-modules-on-hubs.md)).

## Gotchas

- A reorder must name every followed team (409 otherwise); a new follow goes last.
- `user_follows` stores the team's Baseline UUID, checked against `gold.dim_teams` when written, so it survives dbt rebuilds. The table also allows players, which are not offered yet.

## Operations

Blocking an account and reviewing chat usage: [operations.md](../operations.md#accounts-chat-and-picks).

## Out of scope

Following players (the table allows it; the product doesn't offer it yet), and email.
