from functools import lru_cache
from typing import Literal

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    database_url: str | None = None
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "nba"
    postgres_user: str = "nba_user"
    postgres_password: str = "nba_pass"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    nlp_backend: Literal["rules", "llm"] = "rules"
    nlp_llm_api_key: str | None = None
    nlp_llm_base_url: str = "https://api.openai.com/v1"
    nlp_llm_model: str = "gpt-4o-mini"
    # Sent as max_completion_tokens; reasoning tokens count against it.
    nlp_llm_max_output_tokens: int | None = 2000
    # Only sent when set: not every OpenAI-compatible provider accepts it.
    nlp_llm_reasoning_effort: str | None = None
    cube_api_url: str | None = None
    cubejs_api_secret: str | None = None
    # Bearer token for /api/v1/admin/*. Unset means the admin routes are
    # disabled entirely (503), never open.
    admin_api_token: str | None = None
    # Bearer token for /api/v1/account/*, held by the Next.js server. It is what
    # makes the X-Baseline-User header trustworthy, so unset means 503, never open.
    accounts_api_token: str | None = None
    chat_daily_limit: int = 10
    # LLM-backed asks across all users per ET day. Past it, chat answers from
    # the rules backend until the next day.
    chat_global_daily_limit: int = 250
    chat_max_turns: int = 6
    # Rows of a tool result the model sees. The browser still gets every row.
    chat_model_row_cap: int = 50

    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url
        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
