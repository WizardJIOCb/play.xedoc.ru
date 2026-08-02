from __future__ import annotations

import json
import secrets
import sqlite3
import threading
import time
from contextvars import ContextVar, Token
from dataclasses import asdict, dataclass
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


class CredentialStoreError(RuntimeError):
    pass


LEGACY_USER_ID = "legacy-wizardjiocb911"
ANONYMOUS_USER_ID = "anonymous"
_current_user_id: ContextVar[str] = ContextVar("xedoc_play_user_id", default=ANONYMOUS_USER_ID)


@dataclass(slots=True)
class AppUser:
    id: str
    username: str
    display_name: str
    password_hash: str | None
    created_at: int


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
    owner_id: str = LEGACY_USER_ID


class CredentialStore:
    """Encrypted multi-user storage backed by SQLite."""

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
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS app_user (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    display_name TEXT NOT NULL,
                    password_hash TEXT,
                    created_at INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS app_session (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                    expires_at INTEGER NOT NULL,
                    created_at INTEGER NOT NULL
                )
                """
            )
            connection.execute("CREATE INDEX IF NOT EXISTS idx_app_session_expiry ON app_session(expires_at)")
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
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS local_playlist (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    cover_url TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS local_playlist_track (
                    playlist_id TEXT NOT NULL REFERENCES local_playlist(id) ON DELETE CASCADE,
                    track_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    added_at INTEGER NOT NULL,
                    PRIMARY KEY (playlist_id, track_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS listening_event (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    track_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    source TEXT NOT NULL,
                    listened_ms INTEGER NOT NULL,
                    created_at INTEGER NOT NULL
                )
                """
            )
            connection.execute("CREATE INDEX IF NOT EXISTS idx_listening_event_created ON listening_event(created_at DESC)")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS track_listening_stat (
                    track_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    play_count INTEGER NOT NULL,
                    total_listened_ms INTEGER NOT NULL,
                    last_played_at INTEGER NOT NULL
                )
                """
            )
            self._ensure_column(connection, "local_playlist", "owner_id", f"TEXT NOT NULL DEFAULT '{LEGACY_USER_ID}'")
            self._ensure_column(connection, "listening_event", "owner_id", f"TEXT NOT NULL DEFAULT '{LEGACY_USER_ID}'")
            connection.execute("CREATE INDEX IF NOT EXISTS idx_local_playlist_owner ON local_playlist(owner_id, updated_at DESC)")
            connection.execute("CREATE INDEX IF NOT EXISTS idx_listening_owner_created ON listening_event(owner_id, created_at DESC)")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_yandex_credential (
                    user_id TEXT PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
                    encrypted_payload BLOB NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_yandex_binding (
                    user_id TEXT PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
                    user_uid TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_track_listening_stat (
                    user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                    track_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    play_count INTEGER NOT NULL,
                    total_listened_ms INTEGER NOT NULL,
                    last_played_at INTEGER NOT NULL,
                    PRIMARY KEY(user_id, track_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_public_share (
                    token TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL CHECK (kind IN ('track', 'playlist')),
                    resource_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    owner_name TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    UNIQUE(owner_id, kind, resource_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS vk_browser_import_key (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL UNIQUE REFERENCES app_user(id) ON DELETE CASCADE,
                    created_at INTEGER NOT NULL,
                    last_used_at INTEGER
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS vk_import_job (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                    source_url TEXT NOT NULL,
                    track_payload TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed')),
                    total INTEGER NOT NULL,
                    processed INTEGER NOT NULL DEFAULT 0,
                    matched INTEGER NOT NULL DEFAULT 0,
                    unmatched INTEGER NOT NULL DEFAULT 0,
                    playlist_id TEXT,
                    error TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_vk_import_job_user ON vk_import_job(user_id, created_at DESC)"
            )
            connection.execute(
                """
                UPDATE vk_import_job
                SET status = 'failed', error = 'Импорт прерван перезапуском сервиса. Запустите его ещё раз.', updated_at = ?
                WHERE status IN ('queued', 'running')
                """,
                (int(time.time()),),
            )
            now = int(time.time())
            connection.execute(
                """
                INSERT OR IGNORE INTO app_user(id, username, display_name, password_hash, created_at)
                VALUES(?, 'wizardjiocb911', 'wizardjiocb911', NULL, ?)
                """,
                (LEGACY_USER_ID, now),
            )
            connection.execute(
                """
                INSERT OR IGNORE INTO user_yandex_credential(user_id, encrypted_payload, updated_at)
                SELECT ?, encrypted_payload, updated_at FROM yandex_credential WHERE singleton = 1
                """,
                (LEGACY_USER_ID,),
            )
            legacy_uid = connection.execute(
                "SELECT value FROM app_state WHERE key = 'bound_user_uid'"
            ).fetchone()
            if legacy_uid:
                connection.execute(
                    "INSERT OR IGNORE INTO user_yandex_binding(user_id, user_uid) VALUES(?, ?)",
                    (LEGACY_USER_ID, str(legacy_uid[0])),
                )
            connection.execute(
                """
                INSERT OR IGNORE INTO user_track_listening_stat(user_id, track_id, payload, play_count, total_listened_ms, last_played_at)
                SELECT ?, track_id, payload, play_count, total_listened_ms, last_played_at FROM track_listening_stat
                """,
                (LEGACY_USER_ID,),
            )
            connection.execute(
                """
                INSERT OR IGNORE INTO user_public_share(token, owner_id, kind, resource_id, payload, owner_name, created_at)
                SELECT token, ?, kind, resource_id, payload, owner_name, created_at FROM public_share
                """,
                (LEGACY_USER_ID,),
            )
            existing_stats = connection.execute(
                "SELECT COUNT(*) FROM user_track_listening_stat WHERE user_id = ?",
                (LEGACY_USER_ID,),
            ).fetchone()[0]
            if not existing_stats:
                connection.execute(
                    """
                    INSERT INTO user_track_listening_stat(user_id, track_id, payload, play_count, total_listened_ms, last_played_at)
                    SELECT ?, grouped.track_id,
                           (SELECT recent.payload FROM listening_event recent
                            WHERE recent.owner_id = ? AND recent.track_id = grouped.track_id AND recent.source = 'player'
                            ORDER BY recent.created_at DESC, recent.id DESC LIMIT 1),
                           grouped.play_count, grouped.total_listened_ms, grouped.last_played_at
                    FROM (
                        SELECT track_id, COUNT(*) AS play_count, SUM(listened_ms) AS total_listened_ms,
                               MAX(created_at) AS last_played_at
                        FROM listening_event WHERE owner_id = ? AND source = 'player' GROUP BY track_id
                    ) grouped
                    """,
                    (LEGACY_USER_ID, LEGACY_USER_ID, LEGACY_USER_ID),
                )

    @staticmethod
    def _ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
        columns = {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in columns:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def set_current_user(self, user_id: str) -> Token[str]:
        return _current_user_id.set(user_id)

    def reset_current_user(self, token: Token[str]) -> None:
        _current_user_id.reset(token)

    def current_user_id(self) -> str:
        return _current_user_id.get()

    def create_user(self, username: str, display_name: str, password_hash: str) -> AppUser:
        user = AppUser(
            id=f"user-{secrets.token_urlsafe(18)}",
            username=username.strip().casefold(),
            display_name=display_name.strip(),
            password_hash=password_hash,
            created_at=int(time.time()),
        )
        try:
            with self._lock, self._connect() as connection:
                connection.execute(
                    "INSERT INTO app_user(id, username, display_name, password_hash, created_at) VALUES(?, ?, ?, ?, ?)",
                    (user.id, user.username, user.display_name, user.password_hash, user.created_at),
                )
        except sqlite3.IntegrityError as exc:
            raise CredentialStoreError("Username is already registered") from exc
        return user

    def user_by_username(self, username: str) -> AppUser | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT id, username, display_name, password_hash, created_at FROM app_user WHERE username = ? COLLATE NOCASE",
                (username.strip(),),
            ).fetchone()
        return AppUser(*row) if row else None

    def user_by_id(self, user_id: str) -> AppUser | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT id, username, display_name, password_hash, created_at FROM app_user WHERE id = ?",
                (user_id,),
            ).fetchone()
        return AppUser(*row) if row else None

    def set_user_password(self, user_id: str, password_hash: str) -> bool:
        with self._lock, self._connect() as connection:
            cursor = connection.execute("UPDATE app_user SET password_hash = ? WHERE id = ?", (password_hash, user_id))
        return bool(cursor.rowcount)

    def save_app_session(self, token_hash: str, user_id: str, expires_at: int) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM app_session WHERE expires_at < ?", (int(time.time()),))
            connection.execute(
                "INSERT INTO app_session(token_hash, user_id, expires_at, created_at) VALUES(?, ?, ?, ?)",
                (token_hash, user_id, expires_at, int(time.time())),
            )

    def user_for_app_session(self, token_hash: str) -> AppUser | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT u.id, u.username, u.display_name, u.password_hash, u.created_at
                FROM app_session s JOIN app_user u ON u.id = s.user_id
                WHERE s.token_hash = ? AND s.expires_at >= ?
                """,
                (token_hash, int(time.time())),
            ).fetchone()
        return AppUser(*row) if row else None

    def delete_app_session(self, token_hash: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM app_session WHERE token_hash = ?", (token_hash,))

    def rotate_vk_browser_import_key(self, token_hash: str) -> None:
        user_id = self.current_user_id()
        now = int(time.time())
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM vk_browser_import_key WHERE user_id = ?", (user_id,))
            connection.execute(
                "INSERT INTO vk_browser_import_key(token_hash, user_id, created_at) VALUES(?, ?, ?)",
                (token_hash, user_id, now),
            )

    def user_for_vk_browser_import_key(self, token_hash: str) -> AppUser | None:
        now = int(time.time())
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT u.id, u.username, u.display_name, u.password_hash, u.created_at
                FROM vk_browser_import_key k JOIN app_user u ON u.id = k.user_id
                WHERE k.token_hash = ?
                """,
                (token_hash,),
            ).fetchone()
            if row:
                connection.execute(
                    "UPDATE vk_browser_import_key SET last_used_at = ? WHERE token_hash = ?",
                    (now, token_hash),
                )
        return AppUser(*row) if row else None

    def create_vk_import_job(self, user_id: str, source_url: str, tracks: list[dict]) -> dict:
        job_id = f"vkjob-{secrets.token_urlsafe(14)}"
        now = int(time.time())
        payload = json.dumps(tracks, ensure_ascii=False, separators=(",", ":"))
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO vk_import_job(
                    id, user_id, source_url, track_payload, status, total,
                    processed, matched, unmatched, created_at, updated_at
                ) VALUES(?, ?, ?, ?, 'queued', ?, 0, 0, 0, ?, ?)
                """,
                (job_id, user_id, source_url, payload, len(tracks), now, now),
            )
        return self.load_vk_import_job(job_id, user_id=user_id) or {}

    def load_vk_import_job(self, job_id: str, *, user_id: str | None = None) -> dict | None:
        owner_id = user_id or self.current_user_id()
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, user_id, source_url, track_payload, status, total, processed,
                       matched, unmatched, playlist_id, error, created_at, updated_at
                FROM vk_import_job WHERE id = ? AND user_id = ?
                """,
                (job_id, owner_id),
            ).fetchone()
        return self._vk_import_job_row(row) if row else None

    def latest_vk_import_job(self) -> dict | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, user_id, source_url, track_payload, status, total, processed,
                       matched, unmatched, playlist_id, error, created_at, updated_at
                FROM vk_import_job WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
                """,
                (self.current_user_id(),),
            ).fetchone()
        return self._vk_import_job_row(row) if row else None

    def update_vk_import_job(
        self,
        job_id: str,
        *,
        status: str | None = None,
        processed: int | None = None,
        matched: int | None = None,
        unmatched: int | None = None,
        playlist_id: str | None = None,
        error: str | None = None,
    ) -> None:
        fields: list[str] = ["updated_at = ?"]
        values: list[object] = [int(time.time())]
        for column, value in (
            ("status", status),
            ("processed", processed),
            ("matched", matched),
            ("unmatched", unmatched),
            ("playlist_id", playlist_id),
            ("error", error),
        ):
            if value is not None:
                fields.append(f"{column} = ?")
                values.append(value)
        values.extend((job_id, self.current_user_id()))
        with self._lock, self._connect() as connection:
            connection.execute(
                f"UPDATE vk_import_job SET {', '.join(fields)} WHERE id = ? AND user_id = ?",
                values,
            )

    @staticmethod
    def _vk_import_job_row(row: tuple) -> dict:
        try:
            tracks = json.loads(row[3])
        except (TypeError, json.JSONDecodeError):
            tracks = []
        return {
            "id": str(row[0]),
            "user_id": str(row[1]),
            "source_url": str(row[2]),
            "tracks": tracks if isinstance(tracks, list) else [],
            "status": str(row[4]),
            "total": int(row[5]),
            "processed": int(row[6]),
            "matched": int(row[7]),
            "unmatched": int(row[8]),
            "playlist_id": row[9],
            "error": row[10],
            "created_at": int(row[11]),
            "updated_at": int(row[12]),
        }

    def save(self, credential: Credential) -> None:
        user_id = self.current_user_id()
        payload = json.dumps(asdict(credential), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        encrypted = self._fernet.encrypt(payload)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO user_yandex_credential(user_id, encrypted_payload, updated_at)
                VALUES(?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    encrypted_payload = excluded.encrypted_payload,
                    updated_at = excluded.updated_at
                """,
                (user_id, encrypted, int(time.time())),
            )

    def load(self) -> Credential | None:
        return self.load_for_user(self.current_user_id())

    def load_for_user(self, user_id: str) -> Credential | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT encrypted_payload FROM user_yandex_credential WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            return None
        try:
            payload = json.loads(self._fernet.decrypt(row[0]))
            return Credential(**payload)
        except (InvalidToken, UnicodeDecodeError, json.JSONDecodeError, TypeError, KeyError) as exc:
            raise CredentialStoreError("Saved Yandex credential cannot be decrypted") from exc

    def delete(self) -> None:
        user_id = self.current_user_id()
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM user_yandex_credential WHERE user_id = ?", (user_id,))

    def bind_user_uid(self, user_uid: str) -> bool:
        user_id = self.current_user_id()
        normalized_uid = str(user_uid)
        with self._lock, self._connect() as connection:
            existing = connection.execute(
                "SELECT user_uid FROM user_yandex_binding WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            if existing is not None:
                return str(existing[0]) == normalized_uid
            connection.execute(
                "INSERT INTO user_yandex_binding(user_id, user_uid) VALUES(?, ?)",
                (user_id, normalized_uid),
            )
        return True

    def bound_user_uid(self) -> str | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT user_uid FROM user_yandex_binding WHERE user_id = ?",
                (self.current_user_id(),),
            ).fetchone()
        return str(row[0]) if row else None

    def healthy(self) -> bool:
        try:
            with self._lock, self._connect() as connection:
                return connection.execute("SELECT 1").fetchone() == (1,)
        except sqlite3.Error:
            return False

    def encrypted_payload(self, user_id: str | None = None) -> bytes | None:
        """Test/diagnostic helper; never decrypts or logs the secret."""
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT encrypted_payload FROM user_yandex_credential WHERE user_id = ?",
                (user_id or self.current_user_id(),),
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
        owner_id = self.current_user_id()
        serialized = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        created_at = int(time.time())
        with self._lock, self._connect() as connection:
            existing = connection.execute(
                "SELECT token, created_at FROM user_public_share WHERE owner_id = ? AND kind = ? AND resource_id = ?",
                (owner_id, kind, resource_id),
            ).fetchone()
            token = str(existing[0]) if existing else secrets.token_urlsafe(24)
            original_created_at = int(existing[1]) if existing else created_at
            connection.execute(
                """
                INSERT INTO user_public_share(token, owner_id, kind, resource_id, payload, owner_name, created_at)
                VALUES(?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(owner_id, kind, resource_id) DO UPDATE SET
                    payload = excluded.payload,
                    owner_name = excluded.owner_name
                """,
                (token, owner_id, kind, resource_id, serialized, owner_name, original_created_at),
            )
        return PublicShare(token, kind, resource_id, payload, owner_name, original_created_at, owner_id)

    def load_public_share(self, token: str) -> PublicShare | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT token, kind, resource_id, payload, owner_name, created_at, owner_id
                FROM user_public_share WHERE token = ?
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
            owner_id=str(row[6]),
        )

    def create_local_playlist(self, title: str, description: str = "") -> dict:
        playlist_id = f"local-{secrets.token_urlsafe(10)}"
        now = int(time.time())
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO local_playlist(id, title, description, created_at, updated_at, owner_id) VALUES(?, ?, ?, ?, ?, ?)",
                (playlist_id, title.strip(), description.strip(), now, now, self.current_user_id()),
            )
        return self.load_local_playlist(playlist_id) or {}

    def list_local_playlists(self) -> list[dict]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT p.id, p.title, p.description, p.cover_url, p.created_at, p.updated_at,
                       COUNT(t.track_id), COALESCE(SUM(json_extract(t.payload, '$.durationMs')), 0)
                FROM local_playlist p
                LEFT JOIN local_playlist_track t ON t.playlist_id = p.id
                WHERE p.owner_id = ?
                GROUP BY p.id
                ORDER BY p.updated_at DESC, p.created_at DESC
                """,
                (self.current_user_id(),),
            ).fetchall()
        return [self._playlist_row(row) for row in rows]

    def load_local_playlist(self, playlist_id: str) -> dict | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT p.id, p.title, p.description, p.cover_url, p.created_at, p.updated_at,
                       COUNT(t.track_id), COALESCE(SUM(json_extract(t.payload, '$.durationMs')), 0)
                FROM local_playlist p
                LEFT JOIN local_playlist_track t ON t.playlist_id = p.id
                WHERE p.id = ? AND p.owner_id = ? GROUP BY p.id
                """,
                (playlist_id, self.current_user_id()),
            ).fetchone()
            if row is None:
                return None
            track_rows = connection.execute(
                "SELECT payload FROM local_playlist_track WHERE playlist_id = ? ORDER BY position, added_at",
                (playlist_id,),
            ).fetchall()
        playlist = self._playlist_row(row)
        try:
            playlist["tracks"] = [json.loads(item[0]) for item in track_rows]
        except (TypeError, json.JSONDecodeError) as exc:
            raise CredentialStoreError("Saved playlist track is invalid") from exc
        return playlist

    def update_local_playlist(self, playlist_id: str, *, title: str | None = None, description: str | None = None, cover_url: str | None = None, update_cover: bool = False) -> dict | None:
        fields: list[str] = []
        values: list[object] = []
        if title is not None:
            fields.append("title = ?")
            values.append(title.strip())
        if description is not None:
            fields.append("description = ?")
            values.append(description.strip())
        if update_cover:
            fields.append("cover_url = ?")
            values.append(cover_url)
        if not fields:
            return self.load_local_playlist(playlist_id)
        fields.append("updated_at = ?")
        values.append(int(time.time()))
        values.extend((playlist_id, self.current_user_id()))
        with self._lock, self._connect() as connection:
            cursor = connection.execute(f"UPDATE local_playlist SET {', '.join(fields)} WHERE id = ? AND owner_id = ?", values)
        return self.load_local_playlist(playlist_id) if cursor.rowcount else None

    def delete_local_playlist(self, playlist_id: str) -> dict | None:
        playlist = self.load_local_playlist(playlist_id)
        if playlist is None:
            return None
        with self._lock, self._connect() as connection:
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("DELETE FROM local_playlist WHERE id = ? AND owner_id = ?", (playlist_id, self.current_user_id()))
        return playlist

    def add_local_playlist_track(self, playlist_id: str, track_id: str, payload: dict) -> dict | None:
        serialized = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        now = int(time.time())
        with self._lock, self._connect() as connection:
            exists = connection.execute(
                "SELECT 1 FROM local_playlist WHERE id = ? AND owner_id = ?",
                (playlist_id, self.current_user_id()),
            ).fetchone()
            if exists is None:
                return None
            position = connection.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM local_playlist_track WHERE playlist_id = ?",
                (playlist_id,),
            ).fetchone()[0]
            connection.execute(
                """
                INSERT INTO local_playlist_track(playlist_id, track_id, position, payload, added_at)
                VALUES(?, ?, ?, ?, ?)
                ON CONFLICT(playlist_id, track_id) DO UPDATE SET payload = excluded.payload
                """,
                (playlist_id, track_id, int(position), serialized, now),
            )
            connection.execute("UPDATE local_playlist SET updated_at = ? WHERE id = ?", (now, playlist_id))
        return self.load_local_playlist(playlist_id)

    def remove_local_playlist_track(self, playlist_id: str, track_id: str) -> dict | None:
        with self._lock, self._connect() as connection:
            exists = connection.execute(
                "SELECT 1 FROM local_playlist WHERE id = ? AND owner_id = ?",
                (playlist_id, self.current_user_id()),
            ).fetchone()
            if exists is None:
                return None
            connection.execute("DELETE FROM local_playlist_track WHERE playlist_id = ? AND track_id = ?", (playlist_id, track_id))
            connection.execute("UPDATE local_playlist SET updated_at = ? WHERE id = ?", (int(time.time()), playlist_id))
        return self.load_local_playlist(playlist_id)

    def save_listening_event(self, track_id: str, payload: dict, listened_ms: int, source: str = "player") -> None:
        serialized = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        user_id = self.current_user_id()
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO listening_event(track_id, payload, source, listened_ms, created_at, owner_id) VALUES(?, ?, ?, ?, ?, ?)",
                (track_id, serialized, source, listened_ms, int(time.time()), user_id),
            )
            if source == "player":
                connection.execute(
                    """
                    INSERT INTO user_track_listening_stat(user_id, track_id, payload, play_count, total_listened_ms, last_played_at)
                    VALUES(?, ?, ?, 1, ?, ?)
                    ON CONFLICT(user_id, track_id) DO UPDATE SET
                        payload = excluded.payload,
                        play_count = user_track_listening_stat.play_count + 1,
                        total_listened_ms = user_track_listening_stat.total_listened_ms + excluded.total_listened_ms,
                        last_played_at = excluded.last_played_at
                    """,
                    (user_id, track_id, serialized, listened_ms, int(time.time())),
                )
            connection.execute(
                """
                DELETE FROM listening_event
                WHERE owner_id = ? AND id NOT IN (
                    SELECT id FROM listening_event WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT 30000
                )
                """,
                (user_id, user_id),
            )

    def list_listening_events(self, limit: int = 1000) -> list[dict]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT track_id, payload, source, listened_ms, created_at FROM listening_event WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
                (self.current_user_id(), max(1, min(limit, 30000))),
            ).fetchall()
        events: list[dict] = []
        for row in rows:
            try:
                payload = json.loads(row[1])
            except (TypeError, json.JSONDecodeError):
                continue
            events.append({"track_id": row[0], "track": payload, "source": row[2], "listened_ms": row[3], "created_at": row[4]})
        return events

    def list_track_stats(self) -> dict[str, dict]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT track_id, play_count, total_listened_ms, last_played_at FROM user_track_listening_stat WHERE user_id = ?",
                (self.current_user_id(),),
            ).fetchall()
        return {
            str(row[0]): {
                "play_count": int(row[1]),
                "total_listened_ms": int(row[2]),
                "last_played_at": int(row[3]),
            }
            for row in rows
        }

    def top_tracks(self, *, days: int | None = None, limit: int = 200) -> list[dict]:
        limit = max(1, min(limit, 500))
        user_id = self.current_user_id()
        with self._lock, self._connect() as connection:
            if days is None:
                rows = connection.execute(
                    """
                    SELECT track_id, payload, play_count, total_listened_ms, last_played_at
                    FROM user_track_listening_stat
                    WHERE user_id = ?
                    ORDER BY play_count DESC, total_listened_ms DESC, last_played_at DESC
                    LIMIT ?
                    """,
                    (user_id, limit),
                ).fetchall()
            else:
                cutoff = int(time.time()) - max(1, days) * 86_400
                rows = connection.execute(
                    """
                    SELECT grouped.track_id,
                           (SELECT recent.payload FROM listening_event recent
                            WHERE recent.owner_id = ? AND recent.track_id = grouped.track_id AND recent.source = 'player' AND recent.created_at >= ?
                            ORDER BY recent.created_at DESC, recent.id DESC LIMIT 1),
                           grouped.play_count, grouped.total_listened_ms, grouped.last_played_at
                    FROM (
                        SELECT track_id, COUNT(*) AS play_count, SUM(listened_ms) AS total_listened_ms,
                               MAX(created_at) AS last_played_at
                        FROM listening_event
                        WHERE owner_id = ? AND source = 'player' AND created_at >= ?
                        GROUP BY track_id
                    ) grouped
                    ORDER BY grouped.play_count DESC, grouped.total_listened_ms DESC, grouped.last_played_at DESC
                    LIMIT ?
                    """,
                    (user_id, cutoff, user_id, cutoff, limit),
                ).fetchall()
        result: list[dict] = []
        for row in rows:
            try:
                payload = json.loads(row[1])
            except (TypeError, json.JSONDecodeError):
                continue
            result.append({
                "track": payload,
                "play_count": int(row[2]),
                "total_listened_ms": int(row[3]),
                "last_played_at": int(row[4]),
            })
        return result

    @staticmethod
    def _playlist_row(row: tuple) -> dict:
        duration_ms = int(row[7] or 0)
        description = str(row[2] or "")
        return {
            "id": str(row[0]),
            "title": str(row[1]),
            "subtitle": description or "Плейлист XEDOC",
            "description": description or None,
            "coverUrl": row[3],
            "coverTone": "violet",
            "trackCount": int(row[6] or 0),
            "durationMinutes": round(duration_ms / 60_000) if duration_ms else None,
            "local": True,
        }
