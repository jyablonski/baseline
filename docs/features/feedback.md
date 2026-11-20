---
summary: The public /feedback form — anyone can report a wrong number or a bug, or send an idea, without signing in.
status: current
code:
  - services/frontend/src/app/feedback/
  - services/frontend/src/components/feedback/
  - services/frontend/src/components/admin/feedback-panel.tsx
  - services/frontend/src/components/admin/feedback-resolve.tsx
  - services/frontend/src/lib/feedback.ts
  - services/api/src/routers/feedback.py
  - services/api/src/queries/feedback.py
  - services/api/src/repositories/feedback.py
  - services/api/src/schemas/feedback.py
  - services/api/src/services/feedback.py
related:
  - docs/features/admin.md
  - docs/features/accounts-and-follows.md
---

# Feedback

## What users see

- **`/feedback`**: a form with a kind (a wrong number, something broken, an idea, something else), a message of 10 to 2,000 characters, and an optional email for a reply. Sending shows "Thanks, got it." in place of the form. The contact email stays under the form for anyone who prefers it.
- **Entry points:** "Report it" under Limits on `/data` opens the form set to a wrong number, with `/data` as the page (`/feedback?kind=data&from=/data`). The footer's Contact link and the Feedback section on `/about` open it set to something else. `?kind=` and `?from=` work from any link; an unknown kind becomes "something else" and a `from` that is not a path on this site is dropped.
- **Too many:** past 5 reports from one address in an hour, or 100 across the site in a day, the form says so and keeps what was typed.
- **Off:** with the `feedback` flag off, the page shows the contact email instead of the form.
- **The owner:** each report is posted to Slack, and the Feedback tab on `/admin` lists them, open first, with Resolve and Reopen. The tab carries a grey count of open reports ([admin.md](admin.md)).

## How it works

The form posts to a server action, which reads the visitor's address from the first `X-Forwarded-For` entry Caddy sets, adds the account id when the visitor is signed in, and calls `POST /api/v1/feedback` with `ACCOUNTS_API_TOKEN`. The browser never calls the API. The API checks, in order: the `feedback` flag (503), the honeypot (a hidden `website` field; a filled one gets the same 201 and nothing is stored), the address header (400 without it), the per-address hourly limit and the site-wide daily cap (429), then stores the report in `source.feedback` and posts to `SLACK_WEBHOOK_URL` after the response is sent.

`source.feedback` is Alembic-owned and written only by the API, like `source.picks`; it is never a dbt source or a Cube model. It keeps the kind, the message, the optional reply email, the page path, the account id when signed in, and `ip_hash`: an HMAC-SHA256 of the address keyed with `ACCOUNTS_API_TOKEN`. The raw address is never stored. The daily cap counts the Eastern day, like the chat budget.

## Surfaces

- `POST /api/v1/feedback`: called only from the server action, with `X-Baseline-Client-IP` and, when signed in, `X-Baseline-User`.
- `GET /api/v1/admin/feedback?include_resolved=&limit=&offset=` and `PUT /api/v1/admin/feedback/{feedback_id}` with `{resolved}`, behind `ADMIN_API_TOKEN`. Neither returns `ip_hash`.
- The `feedback` feature flag ([admin.md](admin.md)).
- One Slack post per stored report: kind, signed in or anonymous, page, and the first 300 characters.

## Knobs

`FEEDBACK_IP_HOURLY_LIMIT` (5), `FEEDBACK_GLOBAL_DAILY_LIMIT` (100), `SLACK_WEBHOOK_URL` (unset skips Slack, never the report), and the `feedback` flag.

## Invariants

- **Anonymous, so never trusted.** The session only credits a report to an account; a stale or blocked account's report is stored as anonymous rather than refused.
- **No raw IP address is stored**, only the keyed hash, and it never leaves the API.
- **Everything a visitor wrote is shown as text.** The admin tab renders the message as plain text, and the page link is a same-site path the API refused to store otherwise (`//host`, `https://…` and backslashes are a 422).
- **Slack text is escaped** (`&`, `<`, `>`), so a report cannot ping `<!channel>` or show a forged link.
- **A Slack failure never loses a report:** the post runs after the response and its errors are only logged.
- Deleting an account keeps its reports and clears their account id.

## Gotchas

- The per-address limit relies on Caddy replacing any `X-Forwarded-For` a client sends, which it does with no `trusted_proxies` set. If a CDN or proxy is ever put in front of Caddy, every visitor would arrive from the proxy's address; `clientIpFrom` in `lib/feedback.ts` is the line to change.
- With no forwarding header at all (local `next dev` behind nothing), every sender shares one `unknown` bucket: stricter than intended, never looser.
- Rotating `ACCOUNTS_API_TOKEN` restarts every address's hourly count, because it keys the hash.
- A 503 from the API, whether the flag is off or the token is unset, shows the email fallback. The API's wording is not passed through, since one of its 503s names configuration.

## Out of scope

Screenshots or any upload, replying from the app or emailing the sender, report buttons on individual game or player pages, a CAPTCHA, and deleting old reports automatically.
