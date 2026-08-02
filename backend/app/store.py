from __future__ import annotations

import json
import secrets
import sqlite3
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


class CredentialStoreError(RuntimeError):
    pass


@dataclass(slots=True)
class Credential:
    access_token: str
    refresh_token: str | None
    expires_at: int | None
    device_id: str
    user_uid: str
    user_name: str
    avatar_url: str | None = None
    session_id: str = ""

    @property
    def expires_soon(self) -> bool:
        return self.expires_at is not None and self.expires_at <= int(time.time()) + 60


@dataclass(slots=True)
class PublicShare:
    token: str
    kind: str
    resource_id: str
    payload: dict
    owner_name: str
    created_at: int


class CredentialStore:
    """Single-account encrypted credential storage backed by SQLite."""

    def __init__(self, database_path: Path, encryption_key: bytes):
        self.path = Path(database_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fernet = Fernet(encryption_key)
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=5000")
        return connection

    def _initialize(self) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS yandex_credential (
                    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                    encrypted_payload BLOB NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS app_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS public_share (
                    token TEXT PRIMARY KEY,
                    kind TEXT NOT NULL CHECK (kind IN ('track', 'playlist')),
                    resource_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    owner_name TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    UNIQUE(kind, resource_id)
                )
                """
            )

    def save(self, credential: Credential) -> None:
        payload = json.dumps(asdict(credential), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        encrypted = self._fernet.encrypt(payload)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO yandex_credential(singleton, encrypted_payload, updated_at)
                VALUES(1, ?, ?)
                ON CONFLICT(singleton) DO UPDATE SET
                    encrypted_payload = excluded.encrypted_payload,
                    updated_at = excluded.updated_at
                """,
                (encrypted, int(time.time())),
            )

    def load(self) -> Credential | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT encrypted_payload FROM yandex_credential WHERE singleton = 1"
            ).fetchone()
        if row is None:
            return None
        try:
            payload = json.loads(self._fernet.decrypt(row[0]))
            return Credential(**payload)
        except (InvalidToken, UnicodeDecodeError, json.JSONDecodeError, TypeError, KeyError) as exc:
            raise CredentialStoreError("Saved Yandex credential cannot be decrypted") from exc

    def delete(self) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM yandex_credential WHERE singleton = 1")

    def bind_user_uid(self, user_uid: str) -> bool:
        """Pin the first connected account and reject later replacements."""
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO app_state(key, value) VALUES('bound_user_uid', ?)",
                (str(user_uid),),
            )
            row = connection.execute(
                "SELECT value FROM app_state WHERE key = 'bound_user_uid'"
            ).fetchone()
        return row is not None and row[0] == str(user_uid)

    def bound_user_uid(self) -> str | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT value FROM app_state WHERE key = 'bound_user_uid'"
            ).fetchone()
        return str(row[0]) if row else None

    def healthy(self) -> bool:
        try:
            with self._lock, self._connect() as connection:
                return connection.execute("SELECT 1").fetchone() == (1,)
        except sqlite3.Error:
            return False

    def encrypted_payload(self) -> bytes | None:
        """Test/diagnostic helper; never decrypts or logs the secret."""
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT encrypted_payload FROM yandex_credential WHERE singleton = 1"
            ).fetchone()
        return row[0] if row else None

    def save_public_share(
        self,
        *,
        kind: str,
        resource_id: str,
        payload: dict,
        owner_name: str,
    ) -> PublicShare:
        if kind not in {"track", "playlist"}:
            raise ValueError("Unsupported public share kind")
        serialized = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        created_at = int(time.time())
        with self._lock, self._connect() as connection:
            existing = connection.execute(
                "SELECT token, created_at FROM public_share WHERE kind = ? AND resource_id = ?",
                (kind, resource_id),
            ).fetchone()
            token = str(existing[0]) if existing else secrets.token_urlsafe(24)
            original_created_at = int(existing[1]) if existing else created_at
            connection.execute(
                """
                INSERT INTO public_share(token, kind, resource_id, payload, owner_name, created_at)
                VALUES(?, ?, ?, ?, ?, ?)
                ON CONFLICT(kind, resource_id) DO UPDATE SET
                    payload = excluded.payload,
                    owner_name = excluded.owner_name
                """,
                (token, kind, resource_id, serialized, owner_name, original_created_at),
            )
        return PublicShare(token, kind, resource_id, payload, owner_name, original_created_at)

    def load_public_share(self, token: str) -> PublicShare | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT token, kind, resource_id, payload, owner_name, created_at
                FROM public_share WHERE token = ?
                """,
                (token,),
            ).fetchone()
        if row is None:
            return None
        try:
            payload = json.loads(row[3])
        except (TypeError, json.JSONDecodeError) as exc:
            raise CredentialStoreError("Saved public share is invalid") from exc
        if not isinstance(payload, dict):
            raise CredentialStoreError("Saved public share is invalid")
        return PublicShare(
            token=str(row[0]),
            kind=str(row[1]),
            resource_id=str(row[2]),
            payload=payload,
            owner_name=str(row[4]),
            created_at=int(row[5]),
        )
