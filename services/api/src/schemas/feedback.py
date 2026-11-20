import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

FeedbackKind = Literal["data", "bug", "idea", "other"]

MIN_FEEDBACK_CHARS = 10
MAX_FEEDBACK_CHARS = 2000
MAX_PAGE_PATH_CHARS = 512

# Deliberately loose: one @, something either side, a dot in the domain. The
# address is only ever shown to the admin as a mailto link, never sent to.
_EMAIL_SHAPE = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class FeedbackRequest(BaseModel):
    kind: FeedbackKind
    message: str = Field(max_length=MAX_FEEDBACK_CHARS * 2)
    reply_email: str | None = Field(default=None, max_length=254)
    page_path: str | None = Field(default=None, max_length=2048)
    # The honeypot: a field people never see, so anything in it came from a bot.
    website: str | None = Field(default=None, max_length=2048)

    @field_validator("message")
    @classmethod
    def _message_length(cls, value: str) -> str:
        value = value.strip()
        if len(value) < MIN_FEEDBACK_CHARS:
            raise ValueError(f"Say a little more: at least {MIN_FEEDBACK_CHARS} characters.")
        if len(value) > MAX_FEEDBACK_CHARS:
            raise ValueError(f"Keep it under {MAX_FEEDBACK_CHARS} characters.")
        return value

    @field_validator("reply_email")
    @classmethod
    def _email_shape(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        if not value:
            return None
        if not re.match(_EMAIL_SHAPE, value):
            raise ValueError("That email address does not look right.")
        return value

    @field_validator("page_path")
    @classmethod
    def _site_path(cls, value: str | None) -> str | None:
        """A path on this site, or nothing.

        The admin page links to it, so `//evil.example` (protocol-relative) and
        `https://…` are refused rather than stored.
        """
        value = (value or "").strip()
        if not value:
            return None
        if not value.startswith("/") or value.startswith("//") or "\\" in value:
            raise ValueError("The page must be a path on this site.")
        return value[:MAX_PAGE_PATH_CHARS]


class FeedbackReceipt(BaseModel):
    received: bool = True


class FeedbackItem(BaseModel):
    """A report as the admin sees it. The IP hash never leaves the API."""

    model_config = ConfigDict(from_attributes=True)

    feedback_id: UUID
    kind: FeedbackKind
    message: str
    reply_email: str | None = None
    page_path: str | None = None
    signed_in: bool
    created_at: datetime
    resolved_at: datetime | None = None


class FeedbackUpdate(BaseModel):
    resolved: bool
