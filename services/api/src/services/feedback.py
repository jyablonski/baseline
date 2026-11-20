"""Feedback reports: the IP hash behind the rate limit, and the Slack post.

The raw IP address is never stored. It is HMAC'd with ACCOUNTS_API_TOKEN, a
secret only the API and the Next.js server hold, so a leaked table cannot be
reversed by hashing every IPv4 address. Rotating that token starts every
address's hourly count afresh, which is harmless.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import urllib.request

logger = logging.getLogger(__name__)

KIND_LABEL = {
    "data": "Wrong data",
    "bug": "Bug",
    "idea": "Idea",
    "other": "Other",
}

SLACK_PREVIEW_CHARS = 300
SLACK_TIMEOUT_SECONDS = 5


def hash_ip(ip: str, key: str) -> str:
    return hmac.new(key.encode(), ip.strip().lower().encode(), hashlib.sha256).hexdigest()


def slack_escape(value: str) -> str:
    """Slack's three control characters.

    Without this a report could carry `<!channel>` and ping everyone, or
    `<https://evil|Admin>` and show a forged link.
    """
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def slack_text(report: dict) -> str:
    message = report["message"]
    if len(message) > SLACK_PREVIEW_CHARS:
        message = message[:SLACK_PREVIEW_CHARS].rstrip() + "…"
    sender = "signed in" if report.get("signed_in") else "anonymous"
    where = report.get("page_path") or "no page"
    lines = [
        f"*Feedback: {KIND_LABEL[report['kind']]}* ({sender}, {slack_escape(where)})",
        "> " + slack_escape(message).replace("\n", "\n> "),
        "Review it in Admin › Feedback.",
    ]
    return "\n".join(lines)


def post_to_slack(webhook_url: str | None, report: dict) -> None:
    """Best effort. Runs after the response, so a Slack outage never loses a report."""
    url = (webhook_url or "").strip()
    if not url:
        return
    body = json.dumps({"text": slack_text(report)}).encode()
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=SLACK_TIMEOUT_SECONDS):
            pass
    except Exception as exc:
        # The webhook URL is a secret and urllib errors can carry it, so only the type is logged.
        logger.warning("Feedback Slack post failed: %s", type(exc).__name__)
