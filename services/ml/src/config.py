from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _repo_root() -> Path | None:
    here = Path(__file__).resolve()
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
    champion_model_version: str = "elo-v0"
    logit_model_version: str = "logit-v1"
    logit_cold_start_games: int = 10
    score_horizon_days: int = 7

    @model_validator(mode="after")
    def assemble_database_url(self) -> Settings:
        if not self.database_url:
            self.database_url = (
                f"postgresql://{self.postgres_user}:{self.postgres_password}"
                f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
            )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
