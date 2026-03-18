"""CI environment settings loaded from environment variables and optional .env file.

In GitHub Actions, standard variables like GITHUB_TOKEN and CI are set
automatically. Locally, create a .env file or set them in your shell.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class CISettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    github_token: str = ""
    github_repository: str = ""
    github_sha: str = ""
    ci: bool = False
