<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

The public product name in the UI is **Baseline**.

## User-facing copy

Never put operator instructions in the app. Empty states, error messages, and tooltips are read by visitors, not by whoever runs the pipeline: they cannot enable a scraper, set `REDDIT_*`, or run a Make target, and naming those things leaks internal configuration and reads as a broken build. Say what is true about the data ("nothing has been collected for these days yet"), not what an admin should do about it. Operator remedies belong in `/admin`, `docs/operations.md`, or a log line.
