from __future__ import annotations

import base64
import hashlib
from functools import lru_cache
from pathlib import Path
from typing import Literal

from cryptography.fernet import Fernet
from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    """Runtime configuration loaded from PLAY_* environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="PLAY_",
        env_file=(BACKEND_ROOT.parent / ".env", BACKEND_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"
    public_origin: str = "https://play.xedoc.ru"
    access_key: SecretStr = SecretStr("change-me")
    cookie_secret: SecretStr = SecretStr("dev-only-change-me-cookie-secret")
    token_encryption_key: SecretStr | None = None
    database_path: Path = BACKEND_ROOT / "data" / "play.db"

    cookie_secure: bool = True
    cookie_domain: str | None = None
    access_cookie_name: str = "xedoc_access"
    session_cookie_name: str = "xedoc_music_session"
    user_cookie_name: str = "xedoc_user_session"
    access_ttl_hours: int = 24
    session_ttl_days: int = 30
    registration_enabled: bool = True

    demo_fallback: bool = True
    yandex_allowed_uid: str | None = None
    yandex_client_id: SecretStr | None = None
    yandex_client_secret: SecretStr | None = None
    request_timeout_seconds: float = 20.0

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        client_id, client_secret = self.yandex_credentials
        if bool(client_id) != bool(client_secret):
            raise ValueError("PLAY_YANDEX_CLIENT_ID and PLAY_YANDEX_CLIENT_SECRET must be set together")
        if self.environment != "production":
            return self

        problems: list[str] = []
        if len(self.access_key.get_secret_value()) < 16 or self.access_key.get_secret_value() == "change-me":
            problems.append("PLAY_ACCESS_KEY")
        if len(self.cookie_secret.get_secret_value()) < 32 or self.cookie_secret.get_secret_value() == "dev-only-change-me-cookie-secret":
            problems.append("PLAY_COOKIE_SECRET")
        token_key = self.token_encryption_key.get_secret_value().strip() if self.token_encryption_key else ""
        if not token_key:
            problems.append("PLAY_TOKEN_ENCRYPTION_KEY")
        else:
            try:
                Fernet(token_key.encode("ascii"))
            except (ValueError, TypeError):
                problems.append("PLAY_TOKEN_ENCRYPTION_KEY (invalid Fernet key)")
        if problems:
            joined = ", ".join(problems)
            raise ValueError(f"Production secrets are not configured: {joined}")
        return self

    @property
    def fernet_key(self) -> bytes:
        configured = self.token_encryption_key
        if configured is not None and configured.get_secret_value().strip():
            value = configured.get_secret_value().strip().encode("ascii")
            # Validate eagerly so a typo never silently loses access to saved data.
            Fernet(value)
            return value

        # Development-only deterministic fallback. Production rejects this above.
        digest = hashlib.sha256(self.cookie_secret.get_secret_value().encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest)

    @property
    def yandex_credentials(self) -> tuple[str | None, str | None]:
        client_id = self.yandex_client_id.get_secret_value() if self.yandex_client_id else None
        client_secret = self.yandex_client_secret.get_secret_value() if self.yandex_client_secret else None
        return client_id or None, client_secret or None


@lru_cache
def get_settings() -> Settings:
    return Settings()
