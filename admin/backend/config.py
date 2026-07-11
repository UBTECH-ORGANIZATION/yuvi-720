"""Environment-backed settings for the standalone administration service."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


ADMIN_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ADMIN_DIR / ".env")


def _boolean(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    """Runtime configuration loaded exclusively from environment variables."""

    mongodb_connection_string: str
    mongodb_database: str
    admin_emails: frozenset[str]
    admin_secret_key: str
    google_client_id: str
    google_client_secret: str
    admin_base_url: str
    secure_cookies: bool
    port: int
    environment: str

    @property
    def oauth_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @classmethod
    def from_environment(cls) -> "Settings":
        environment = os.getenv("ADMIN_ENV", "development").strip().lower()
        base_url = os.getenv("ADMIN_BASE_URL", "http://localhost:9998").rstrip("/")
        secret_key = os.getenv("ADMIN_SECRET_KEY", "").strip()
        if not secret_key:
            if environment in {"production", "prod"}:
                raise RuntimeError("ADMIN_SECRET_KEY is required in production")
            secret_key = secrets.token_urlsafe(48)
            print("⚠️ ADMIN_SECRET_KEY is unset; using an ephemeral development key")

        emails = frozenset(
            email.strip().lower()
            for email in os.getenv("ADMIN_EMAILS", "").split(",")
            if email.strip()
        )
        return cls(
            mongodb_connection_string=os.getenv("MONGODB_CONNECTION_STRING", "").strip(),
            mongodb_database=os.getenv("MONGODB_DATABASE", "yuvi720").strip() or "yuvi720",
            admin_emails=emails,
            admin_secret_key=secret_key,
            google_client_id=os.getenv("GOOGLE_CLIENT_ID", "").strip(),
            google_client_secret=os.getenv("GOOGLE_CLIENT_SECRET", "").strip(),
            admin_base_url=base_url,
            secure_cookies=_boolean("ADMIN_COOKIE_SECURE", base_url.startswith("https://")),
            port=int(os.getenv("ADMIN_PORT", os.getenv("PORT", "9998"))),
            environment=environment,
        )
