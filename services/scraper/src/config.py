from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _repo_root() -> Path | None:
    """Return the monorepo root when running from a checkout."""
    here = Path(__file__).resolve()
    # services/scraper/src/config.py -> repo root is parents[3]
    if len(here.parents) >= 4:
        candidate = here.parents[3]
        if (candidate / "docker-compose.yml").exists() or (candidate / ".env").exists():
            return candidate
    for start in (Path.cwd(), *Path.cwd().parents):
        if (start / "docker-compose.yml").exists() or (start / "db" / "init.sql").exists():
            return start
    return None


def _env_file() -> Path | None:
    root = _repo_root()
    if root is not None:
        env_path = root / ".env"
        if env_path.is_file():
            return env_path
    cwd_env = Path.cwd() / ".env"
    if cwd_env.is_file():
        return cwd_env
    return None


_ENV_FILE = _env_file()
if _ENV_FILE is not None:
    load_dotenv(_ENV_FILE, override=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "nba"
    postgres_user: str = "nba_user"
    postgres_password: str = "nba_pass"
    database_url: str = ""
    slack_webhook_url: str | None = None
    # Consecutive unhealthy runs (failed, or zero rows from a source that should
    # always have some) before a source alerts. One miss is usually "not
    # published yet"; three in a row is a parser break or an upstream change.
    source_alert_streak: int = Field(default=3, ge=1)
    odds_api_key: str | None = None

    reddit_client_id: str = ""
    reddit_client_secret: str = ""
    reddit_user_agent: str = ""
    reddit_username: str = ""
    reddit_password: str = ""

    @field_validator("slack_webhook_url", "odds_api_key", mode="before")
    @classmethod
    def empty_optional_secret(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="after")
    def assemble_database_url(self) -> Settings:
        if not self.database_url:
            self.database_url = (
                f"postgresql://{self.postgres_user}:{self.postgres_password}"
                f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
            )
        return self


class RedditConfigError(ValueError):
    """Required REDDIT_* settings are missing. Raised before PRAW is constructed."""


_REDDIT_REQUIRED = (
    ("REDDIT_CLIENT_ID", "reddit_client_id"),
    ("REDDIT_CLIENT_SECRET", "reddit_client_secret"),
    ("REDDIT_USER_AGENT", "reddit_user_agent"),
)


def missing_odds_env_names(cfg: Settings | None = None) -> list[str]:
    """Return unset Odds API env var names (empty list if configured).

    Mirrors ``missing_reddit_env_names`` so the pipeline can tell "no key, so
    we never tried" apart from "we tried and got nothing back".
    """
    resolved = cfg if cfg is not None else get_settings()
    if not str(resolved.odds_api_key or "").strip():
        return ["ODDS_API_KEY"]
    return []


def missing_reddit_env_names(cfg: Settings | None = None) -> list[str]:
    """Return unset required Reddit env var names (empty list if complete)."""
    resolved = cfg if cfg is not None else get_settings()
    missing: list[str] = []
    for env_name, attr in _REDDIT_REQUIRED:
        value = getattr(resolved, attr, "")
        if not str(value or "").strip():
            missing.append(env_name)
    return missing


def require_reddit_settings(cfg: Settings | None = None) -> Settings:
    """Return settings if Reddit creds are present; otherwise raise RedditConfigError."""
    resolved = cfg if cfg is not None else get_settings()
    missing = missing_reddit_env_names(resolved)
    if missing:
        raise RedditConfigError("Reddit credentials are missing. Set " + ", ".join(missing) + ".")
    return resolved


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
