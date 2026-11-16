# 0006: Ask runs on the rules backend; the LLM path stays off

**Status:** Accepted. **Recorded:** 2026-11-16; the LLM path was confirmed off on 2026-11-09.

## Context

Ask answers questions over Cube. An LLM adapter exists (`NLP_BACKEND=llm`, Chat behind the `chatbot` flag), but it costs money per question and has quota and concurrency risks that matter only once it is on.

## Decision

`NLP_BACKEND=rules` is the public default. The LLM path is opt-in and currently off in production. Neither backend runs SQL; both go through Cube.

## Consequences

- Reviews skip LLM spend, quota and concurrency findings while it stays off. Rules-backend and public `/query` issues still count.
- An unrecognised question returns a capability message, not an error.
