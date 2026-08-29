from __future__ import annotations

import json
import math
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
NOW_PLAYING_MAX_AGE_SECONDS = 90
_current_user_id: ContextVar[str] = ContextVar("xedoc_play_user_id", default=ANONYMOUS_USER_ID)


@dataclass(slots=True)
class AppUser:
    id: str
    username: str
    display_name: str
    password_hash: str | None
    created_at: int
    avatar_url: str | None = None
    is_admin: bool = False


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
        connection.execute("PRAGMA foreign_keys=ON")
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
            self._ensure_column(connection, "app_user", "is_admin", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column(connection, "app_user", "avatar_url", "TEXT")
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
            self._ensure_column(connection, "local_playlist", "is_public", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column(connection, "listening_event", "owner_id", f"TEXT NOT NULL DEFAULT '{LEGACY_USER_ID}'")
            connection.execute("CREATE INDEX IF NOT EXISTS idx_local_playlist_owner ON local_playlist(owner_id, updated_at DESC)")
            connection.execute("CREATE INDEX IF NOT EXISTS idx_local_playlist_public ON local_playlist(owner_id, is_public, updated_at DESC)")
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
                CREATE TABLE IF NOT EXISTS user_track_like (
                    user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                    track_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    liked_at INTEGER NOT NULL,
                    PRIMARY KEY(user_id, track_id)
                )
                """
            )
            connection.execute("CREATE INDEX IF NOT EXISTS idx_user_track_like_recent ON user_track_like(user_id, liked_at DESC)")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_now_playing (
                    user_id TEXT PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
                    track_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    playlist_id TEXT,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            connection.execute("CREATE INDEX IF NOT EXISTS idx_user_now_playing_updated ON user_now_playing(updated_at DESC)")
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
                CREATE TABLE IF NOT EXISTS vk_import_job (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                    source_url TEXT NOT NULL,
                    track_payload TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed')),
                    total INTEGER NOT NULL,
                    reused INTEGER NOT NULL DEFAULT 0,
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
            self._ensure_column(connection, "vk_import_job", "reused", "INTEGER NOT NULL DEFAULT 0")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS social_post (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                    body TEXT NOT NULL DEFAULT '',
                    visibility TEXT NOT NULL CHECK (visibility IN ('public', 'friends')),
                    attachments TEXT NOT NULL DEFAULT '[]',
                    poll_question TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_social_post_created ON social_post(created_at DESC)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_social_post_owner ON social_post(owner_id, created_at DESC)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS social_post_like (
                    post_id TEXT NOT NULL REFERENCES social_post(id) ON DELETE CASCADE,
                    user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                    created_at INTEGER NOT NULL,
                    PRIMARY KEY(post_id, user_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS social_comment (
                    id TEXT PRIMARY KEY,
                    post_id TEXT NOT NULL REFERENCES social_post(id) ON DELETE CASCADE,
                    author_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                    parent_id TEXT REFERENCES social_comment(id) ON DELETE CASCADE,
                    body TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    deleted_at INTEGER
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_social_comment_post ON social_comment(post_id, created_at)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_social_comment_parent ON social_comment(parent_id, created_at)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS social_poll_option (
                    id TEXT PRIMARY KEY,
                    post_id TEXT NOT NULL REFERENCES social_post(id) ON DELETE CASCADE,
                    text TEXT NOT NULL,
                    position INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS social_poll_vote (
                    post_id TEXT NOT NULL REFERENCES social_post(id) ON DELETE CASCADE,
                    option_id TEXT NOT NULL REFERENCES social_poll_option(id) ON DELETE CASCADE,
                    user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                    created_at INTEGER NOT NULL,
                    PRIMARY KEY(post_id, user_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS social_friend (
                    user_low_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                    user_high_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                    requested_by TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY(user_low_id, user_high_id),
                    CHECK(user_low_id < user_high_id)
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_social_friend_status ON social_friend(status, updated_at DESC)"
            )
            connection.execute(
                """
                UPDATE vk_import_job
                SET status = 'queued', error = NULL, updated_at = ?
                WHERE status = 'failed'
                  AND error = 'Импорт прерван перезапуском сервиса. Запустите его ещё раз.'
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
            is_admin=False,
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
                "SELECT id, username, display_name, password_hash, created_at, avatar_url, is_admin FROM app_user WHERE username = ? COLLATE NOCASE",
                (username.strip(),),
            ).fetchone()
        return AppUser(*row) if row else None

    def user_by_id(self, user_id: str) -> AppUser | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT id, username, display_name, password_hash, created_at, avatar_url, is_admin FROM app_user WHERE id = ?",
                (user_id,),
            ).fetchone()
        return AppUser(*row) if row else None

    def set_user_password(self, user_id: str, password_hash: str) -> bool:
        with self._lock, self._connect() as connection:
            cursor = connection.execute("UPDATE app_user SET password_hash = ? WHERE id = ?", (password_hash, user_id))
        return bool(cursor.rowcount)

    def update_user_profile(self, user_id: str, display_name: str, avatar_url: str | None = None) -> AppUser | None:
        with self._lock, self._connect() as connection:
            if avatar_url is None:
                connection.execute(
                    "UPDATE app_user SET display_name = ? WHERE id = ?",
                    (display_name.strip(), user_id),
                )
            else:
                connection.execute(
                    "UPDATE app_user SET display_name = ?, avatar_url = ? WHERE id = ?",
                    (display_name.strip(), avatar_url, user_id),
                )
        return self.user_by_id(user_id)

    def set_user_admin(self, username: str, is_admin: bool) -> bool:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "UPDATE app_user SET is_admin = ? WHERE username = ? COLLATE NOCASE",
                (int(is_admin), username.strip().removeprefix("@")),
            )
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
                SELECT u.id, u.username, u.display_name, u.password_hash, u.created_at, u.avatar_url, u.is_admin
                FROM app_session s JOIN app_user u ON u.id = s.user_id
                WHERE s.token_hash = ? AND s.expires_at >= ?
                """,
                (token_hash, int(time.time())),
            ).fetchone()
        return AppUser(*row) if row else None

    def delete_app_session(self, token_hash: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM app_session WHERE token_hash = ?", (token_hash,))

    def create_vk_import_job(
        self,
        user_id: str,
        source_url: str,
        tracks: list[dict],
        *,
        reused: int = 0,
    ) -> dict:
        job_id = f"vkjob-{secrets.token_urlsafe(14)}"
        now = int(time.time())
        payload = json.dumps(tracks, ensure_ascii=False, separators=(",", ":"))
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO vk_import_job(
                    id, user_id, source_url, track_payload, status, total,
                    processed, matched, unmatched, created_at, updated_at, reused
                ) VALUES(?, ?, ?, ?, 'queued', ?, 0, 0, 0, ?, ?, ?)
                """,
                (job_id, user_id, source_url, payload, len(tracks), now, now, max(0, reused)),
            )
        return self.load_vk_import_job(job_id, user_id=user_id) or {}

    def load_vk_import_job(self, job_id: str, *, user_id: str | None = None) -> dict | None:
        owner_id = user_id or self.current_user_id()
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, user_id, source_url, track_payload, status, total, processed,
                       matched, unmatched, playlist_id, error, created_at, updated_at, reused
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
                       matched, unmatched, playlist_id, error, created_at, updated_at, reused
                FROM vk_import_job WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
                """,
                (self.current_user_id(),),
            ).fetchone()
        return self._vk_import_job_row(row) if row else None

    def incomplete_vk_import_jobs(self) -> list[dict]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, user_id, source_url, track_payload, status, total, processed,
                       matched, unmatched, playlist_id, error, created_at, updated_at, reused
                FROM vk_import_job WHERE status IN ('queued', 'running') ORDER BY created_at
                """
            ).fetchall()
        return [self._vk_import_job_row(row) for row in rows]

    def largest_completed_vk_import_job(self, source_url: str) -> dict | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, user_id, source_url, track_payload, status, total, processed,
                       matched, unmatched, playlist_id, error, created_at, updated_at, reused
                FROM vk_import_job
                WHERE user_id = ? AND source_url = ? AND status = 'complete'
                ORDER BY total DESC, created_at DESC LIMIT 1
                """,
                (self.current_user_id(), source_url),
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
            "reused": int(row[13]),
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

    def load_catalog_credential(self) -> Credential | None:
        """Use an administrator's connected catalog for anonymous public search."""
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT credential.encrypted_payload
                FROM user_yandex_credential credential
                JOIN app_user user ON user.id = credential.user_id
                ORDER BY user.is_admin DESC, credential.updated_at DESC
                LIMIT 1
                """
            ).fetchone()
        if row is None:
            return None
        try:
            payload = json.loads(self._fernet.decrypt(row[0]))
            return Credential(**payload)
        except (InvalidToken, UnicodeDecodeError, json.JSONDecodeError, TypeError, KeyError) as exc:
            raise CredentialStoreError("Public catalog credential cannot be decrypted") from exc

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

    def create_local_playlist(self, title: str, description: str = "", is_public: bool = False) -> dict:
        playlist_id = f"local-{secrets.token_urlsafe(10)}"
        now = int(time.time())
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO local_playlist(id, title, description, created_at, updated_at, owner_id, is_public) VALUES(?, ?, ?, ?, ?, ?, ?)",
                (playlist_id, title.strip(), description.strip(), now, now, self.current_user_id(), int(is_public)),
            )
        return self.load_local_playlist(playlist_id) or {}

    def list_local_playlists(self) -> list[dict]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT p.id, p.title, p.description, p.cover_url, p.created_at, p.updated_at,
                       COUNT(t.track_id), COALESCE(SUM(json_extract(t.payload, '$.durationMs')), 0), p.is_public
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
                       COUNT(t.track_id), COALESCE(SUM(json_extract(t.payload, '$.durationMs')), 0), p.is_public
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

    def update_local_playlist(self, playlist_id: str, *, title: str | None = None, description: str | None = None, is_public: bool | None = None, cover_url: str | None = None, update_cover: bool = False) -> dict | None:
        fields: list[str] = []
        values: list[object] = []
        if title is not None:
            fields.append("title = ?")
            values.append(title.strip())
        if description is not None:
            fields.append("description = ?")
            values.append(description.strip())
        if is_public is not None:
            fields.append("is_public = ?")
            values.append(int(is_public))
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

    def track_play_count(self, track_id: str) -> int:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT play_count FROM user_track_listening_stat WHERE user_id = ? AND track_id = ?",
                (self.current_user_id(), track_id),
            ).fetchone()
        return int(row[0]) if row is not None else 0

    def save_track_like(self, track_id: str, payload: dict) -> None:
        value = dict(payload)
        value.pop("streamUrl", None)
        value.pop("stream_url", None)
        value["liked"] = True
        serialized = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO user_track_like(user_id, track_id, payload, liked_at)
                VALUES(?, ?, ?, ?)
                ON CONFLICT(user_id, track_id) DO UPDATE SET
                    payload = excluded.payload,
                    liked_at = excluded.liked_at
                """,
                (self.current_user_id(), track_id, serialized, int(time.time())),
            )

    def import_track_likes(self, tracks: list[dict]) -> None:
        if not tracks:
            return
        now = int(time.time())
        rows: list[tuple[str, str, str, int]] = []
        for payload in tracks:
            value = dict(payload)
            track_id = str(value.get("id") or "").strip()
            if not track_id:
                continue
            value.pop("streamUrl", None)
            value.pop("stream_url", None)
            value["liked"] = True
            rows.append((self.current_user_id(), track_id, json.dumps(value, separators=(",", ":"), ensure_ascii=False), now))
        with self._lock, self._connect() as connection:
            connection.executemany(
                """
                INSERT INTO user_track_like(user_id, track_id, payload, liked_at)
                VALUES(?, ?, ?, ?)
                ON CONFLICT(user_id, track_id) DO UPDATE SET payload = excluded.payload
                """,
                rows,
            )

    def remove_track_like(self, track_id: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "DELETE FROM user_track_like WHERE user_id = ? AND track_id = ?",
                (self.current_user_id(), track_id),
            )

    def list_track_likes(self, limit: int = 5000) -> list[dict]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT track_id, payload, liked_at
                FROM user_track_like
                WHERE user_id = ?
                ORDER BY liked_at DESC, track_id
                LIMIT ?
                """,
                (self.current_user_id(), max(1, min(limit, 5000))),
            ).fetchall()
        likes: list[dict] = []
        for row in rows:
            try:
                track = json.loads(row[1])
            except (TypeError, json.JSONDecodeError):
                continue
            track["id"] = str(row[0])
            track["liked"] = True
            likes.append({"track": track, "liked_at": int(row[2])})
        return likes

    def liked_track_ids(self) -> set[str]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT track_id FROM user_track_like WHERE user_id = ?",
                (self.current_user_id(),),
            ).fetchall()
        return {str(row[0]) for row in rows}

    def service_tracks(self, *, recent: bool = False, days: int | None = None, limit: int = 50) -> list[dict]:
        limit = max(1, min(limit, 200))
        with self._lock, self._connect() as connection:
            if days is not None:
                cutoff = int(time.time()) - max(1, days) * 86_400
                rows = connection.execute(
                    """
                    SELECT grouped.track_id,
                           (SELECT latest.payload FROM listening_event latest
                            WHERE latest.track_id = grouped.track_id AND latest.source = 'player'
                            ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1),
                           grouped.play_count, grouped.total_listened_ms, grouped.last_played_at
                    FROM (
                        SELECT track_id, COUNT(*) AS play_count,
                               SUM(listened_ms) AS total_listened_ms, MAX(created_at) AS last_played_at
                        FROM listening_event
                        WHERE source = 'player' AND created_at >= ?
                        GROUP BY track_id
                    ) grouped
                    ORDER BY grouped.play_count DESC, grouped.total_listened_ms DESC, grouped.last_played_at DESC
                    LIMIT ?
                    """,
                    (cutoff, limit),
                ).fetchall()
            else:
                order = "grouped.last_played_at DESC" if recent else (
                    "grouped.play_count DESC, grouped.total_listened_ms DESC, grouped.last_played_at DESC"
                )
                rows = connection.execute(
                    f"""
                    SELECT grouped.track_id,
                           (SELECT latest.payload FROM user_track_listening_stat latest
                            WHERE latest.track_id = grouped.track_id
                            ORDER BY latest.last_played_at DESC LIMIT 1),
                           grouped.play_count, grouped.total_listened_ms, grouped.last_played_at
                    FROM (
                        SELECT track_id, SUM(play_count) AS play_count,
                               SUM(total_listened_ms) AS total_listened_ms,
                               MAX(last_played_at) AS last_played_at
                        FROM user_track_listening_stat
                        GROUP BY track_id
                    ) grouped
                    ORDER BY {order}
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
        tracks: list[dict] = []
        for row in rows:
            try:
                track = json.loads(row[1])
            except (TypeError, json.JSONDecodeError):
                continue
            track.pop("streamUrl", None)
            track.pop("stream_url", None)
            track.update({
                "id": str(row[0]),
                "playCount": int(row[2] or 0),
                "totalListenedMs": int(row[3] or 0),
                "lastPlayedAt": int(row[4] or 0),
            })
            tracks.append(track)
        return tracks

    def service_listening_summary(self) -> dict[str, int]:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT COALESCE(SUM(play_count), 0),
                       COUNT(DISTINCT track_id),
                       COALESCE(SUM(total_listened_ms), 0)
                FROM user_track_listening_stat
                """
            ).fetchone()
        return {
            "total_plays": int(row[0] or 0),
            "unique_tracks": int(row[1] or 0),
            "total_listened_ms": int(row[2] or 0),
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

    def search_users(self, query: str, limit: int = 8) -> list[dict]:
        value = query.strip().removeprefix("@").strip()
        if not value:
            return []
        escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        contains = f"%{escaped}%"
        prefix = f"{escaped}%"
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT u.username, u.display_name, COUNT(p.id)
                FROM app_user u
                LEFT JOIN local_playlist p ON p.owner_id = u.id AND p.is_public = 1
                WHERE u.username LIKE ? ESCAPE '\\' COLLATE NOCASE
                   OR u.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
                GROUP BY u.id
                ORDER BY (u.username = ? COLLATE NOCASE) DESC,
                         (u.username LIKE ? ESCAPE '\\' COLLATE NOCASE) DESC,
                         COUNT(p.id) DESC, u.username COLLATE NOCASE
                LIMIT ?
                """,
                (contains, contains, value, prefix, max(1, min(limit, 20))),
            ).fetchall()
        return [
            {"username": str(row[0]), "displayName": str(row[1]), "publicPlaylistCount": int(row[2] or 0)}
            for row in rows
        ]

    def admin_dashboard(self, query: str = "", limit: int = 100) -> dict:
        value = query.strip().removeprefix("@").strip()
        escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        now = int(time.time())
        with self._lock, self._connect() as connection:
            summary_row = connection.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM app_user),
                    (SELECT COUNT(*) FROM app_user WHERE created_at >= ?),
                    (SELECT COUNT(DISTINCT owner_id) FROM listening_event WHERE source = 'player' AND created_at >= ?),
                    (SELECT COUNT(*) FROM user_yandex_credential),
                    (SELECT COUNT(*) FROM local_playlist),
                    (SELECT COUNT(*) FROM local_playlist WHERE is_public = 1),
                    (SELECT COUNT(*) FROM local_playlist_track),
                    (SELECT COALESCE(SUM(play_count), 0) FROM user_track_listening_stat),
                    (SELECT COUNT(DISTINCT track_id) FROM user_track_listening_stat),
                    (SELECT COALESCE(SUM(total_listened_ms), 0) FROM user_track_listening_stat),
                    (SELECT COUNT(*) FROM user_public_share)
                """,
                (now - 7 * 86_400, now - 30 * 86_400),
            ).fetchone()
            user_rows = connection.execute(
                """
                SELECT u.username, u.display_name, u.avatar_url, u.is_admin, u.created_at,
                       EXISTS(SELECT 1 FROM user_yandex_credential c WHERE c.user_id = u.id),
                       (SELECT COUNT(*) FROM local_playlist p WHERE p.owner_id = u.id),
                       (SELECT COUNT(*) FROM local_playlist p WHERE p.owner_id = u.id AND p.is_public = 1),
                       (SELECT COUNT(*) FROM local_playlist_track t JOIN local_playlist p ON p.id = t.playlist_id WHERE p.owner_id = u.id),
                       COALESCE(SUM(s.play_count), 0), COUNT(s.track_id),
                       COALESCE(SUM(s.total_listened_ms), 0), MAX(s.last_played_at)
                FROM app_user u
                LEFT JOIN user_track_listening_stat s ON s.user_id = u.id
                WHERE (? = '' OR u.username LIKE ? ESCAPE '\\' COLLATE NOCASE OR u.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE)
                GROUP BY u.id
                ORDER BY u.created_at DESC, u.username COLLATE NOCASE
                LIMIT ?
                """,
                (value, pattern, pattern, max(1, min(limit, 250))),
            ).fetchall()
            top_rows = connection.execute(
                """
                SELECT track_id, payload, SUM(play_count), SUM(total_listened_ms), MAX(last_played_at)
                FROM user_track_listening_stat
                GROUP BY track_id
                ORDER BY SUM(play_count) DESC, SUM(total_listened_ms) DESC, MAX(last_played_at) DESC
                LIMIT 12
                """
            ).fetchall()
        top_tracks: list[dict] = []
        for row in top_rows:
            try:
                track = json.loads(row[1])
            except (TypeError, json.JSONDecodeError):
                continue
            track.update({
                "playCount": int(row[2] or 0),
                "totalListenedMs": int(row[3] or 0),
                "lastPlayedAt": int(row[4] or 0),
            })
            track.pop("streamUrl", None)
            top_tracks.append(track)
        return {
            "summary": {
                "usersTotal": int(summary_row[0] or 0),
                "newUsers7d": int(summary_row[1] or 0),
                "activeUsers30d": int(summary_row[2] or 0),
                "yandexConnected": int(summary_row[3] or 0),
                "playlistsTotal": int(summary_row[4] or 0),
                "publicPlaylists": int(summary_row[5] or 0),
                "playlistTracks": int(summary_row[6] or 0),
                "totalPlays": int(summary_row[7] or 0),
                "uniqueTracks": int(summary_row[8] or 0),
                "totalListenedMs": int(summary_row[9] or 0),
                "publicShares": int(summary_row[10] or 0),
            },
            "users": [
                {
                    "username": str(row[0]),
                    "displayName": str(row[1]),
                    "avatarUrl": str(row[2]) if row[2] else None,
                    "isAdmin": bool(row[3]),
                    "createdAt": int(row[4]),
                    "yandexConnected": bool(row[5]),
                    "playlists": int(row[6] or 0),
                    "publicPlaylists": int(row[7] or 0),
                    "playlistTracks": int(row[8] or 0),
                    "totalPlays": int(row[9] or 0),
                    "uniqueTracks": int(row[10] or 0),
                    "totalListenedMs": int(row[11] or 0),
                    "lastPlayedAt": int(row[12]) if row[12] is not None else None,
                }
                for row in user_rows
            ],
            "topTracks": top_tracks,
        }

    def load_public_profile(self, username: str) -> dict | None:
        with self._lock, self._connect() as connection:
            user = connection.execute(
                "SELECT id, username, display_name, created_at, avatar_url FROM app_user WHERE username = ? COLLATE NOCASE",
                (username,),
            ).fetchone()
            if user is None:
                return None
            user_id = str(user[0])
            stats = connection.execute(
                """
                SELECT COALESCE(SUM(play_count), 0), COUNT(*), COALESCE(SUM(total_listened_ms), 0)
                FROM user_track_listening_stat WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()
            playlist_rows = connection.execute(
                """
                SELECT p.id, p.title, p.description, p.cover_url, p.created_at, p.updated_at,
                       COUNT(t.track_id), COALESCE(SUM(json_extract(t.payload, '$.durationMs')), 0), p.is_public
                FROM local_playlist p
                LEFT JOIN local_playlist_track t ON t.playlist_id = p.id
                WHERE p.owner_id = ? AND p.is_public = 1
                GROUP BY p.id
                ORDER BY p.updated_at DESC, p.created_at DESC
                """,
                (user_id,),
            ).fetchall()
            top_rows = connection.execute(
                """
                SELECT payload, play_count, total_listened_ms, last_played_at
                FROM user_track_listening_stat
                WHERE user_id = ?
                ORDER BY play_count DESC, total_listened_ms DESC, last_played_at DESC
                LIMIT 5
                """,
                (user_id,),
            ).fetchall()
        top_tracks: list[dict] = []
        for row in top_rows:
            try:
                track = json.loads(row[0])
            except (TypeError, json.JSONDecodeError):
                continue
            track.update({"playCount": int(row[1]), "totalListenedMs": int(row[2]), "lastPlayedAt": int(row[3])})
            track.pop("streamUrl", None)
            top_tracks.append(track)
        playlists = [self._playlist_row(row) for row in playlist_rows]
        profile = {
            "username": str(user[1]),
            "displayName": str(user[2]),
            "memberSince": int(user[3]),
            "avatarUrl": str(user[4]) if user[4] else None,
            "publicPlaylistCount": len(playlists),
            "stats": {
                "totalPlays": int(stats[0] or 0),
                "uniqueTracks": int(stats[1] or 0),
                "totalListenedMs": int(stats[2] or 0),
            },
            "topTracks": top_tracks,
            "playlists": playlists,
        }
        now_playing = self.load_public_now_playing(str(user[1]))
        if now_playing is not None:
            profile["nowPlaying"] = now_playing[0]
        return profile

    def load_public_top_track(self, username: str, track_id: str) -> tuple[dict, str] | None:
        """Return a track only when it belongs to the five public profile highlights."""
        with self._lock, self._connect() as connection:
            user = connection.execute(
                "SELECT id FROM app_user WHERE username = ? COLLATE NOCASE",
                (username,),
            ).fetchone()
            if user is None:
                return None
            user_id = str(user[0])
            rows = connection.execute(
                """
                SELECT payload
                FROM user_track_listening_stat
                WHERE user_id = ?
                ORDER BY play_count DESC, total_listened_ms DESC, last_played_at DESC
                LIMIT 5
                """,
                (user_id,),
            ).fetchall()
        for row in rows:
            try:
                track = json.loads(row[0])
            except (TypeError, json.JSONDecodeError):
                continue
            if str(track.get("id", "")) == track_id:
                track.pop("streamUrl", None)
                return track, user_id
        return None

    def save_now_playing(self, track_id: str, payload: dict, playlist_id: str | None = None) -> None:
        user_id = self.current_user_id()
        if user_id == ANONYMOUS_USER_ID:
            return
        now = int(time.time())
        public_playlist_id: str | None = None
        with self._lock, self._connect() as connection:
            if playlist_id:
                visible = connection.execute(
                    """
                    SELECT 1 FROM local_playlist p
                    JOIN local_playlist_track t ON t.playlist_id = p.id
                    WHERE p.id = ? AND p.owner_id = ? AND p.is_public = 1 AND t.track_id = ?
                    """,
                    (playlist_id, user_id, track_id),
                ).fetchone()
                if visible is not None:
                    public_playlist_id = playlist_id
            connection.execute(
                """
                INSERT INTO user_now_playing(user_id, track_id, payload, playlist_id, updated_at)
                VALUES(?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    track_id = excluded.track_id,
                    payload = excluded.payload,
                    playlist_id = excluded.playlist_id,
                    updated_at = excluded.updated_at
                """,
                (user_id, track_id, json.dumps(payload, ensure_ascii=False), public_playlist_id, now),
            )

    def clear_now_playing(self) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM user_now_playing WHERE user_id = ?", (self.current_user_id(),))

    def load_public_now_playing(self, username: str) -> tuple[dict, str] | None:
        cutoff = int(time.time()) - NOW_PLAYING_MAX_AGE_SECONDS
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT n.payload, n.track_id, n.updated_at, n.playlist_id, u.id
                FROM user_now_playing n
                JOIN app_user u ON u.id = n.user_id
                WHERE u.username = ? COLLATE NOCASE AND n.updated_at >= ?
                """,
                (username, cutoff),
            ).fetchone()
            if row is None:
                return None
            playlist_row = None
            if row[3]:
                playlist_row = connection.execute(
                    """
                    SELECT p.id, p.title, p.description, p.cover_url, p.created_at, p.updated_at,
                           COUNT(t.track_id), COALESCE(SUM(json_extract(t.payload, '$.durationMs')), 0), p.is_public
                    FROM local_playlist p
                    JOIN local_playlist_track current_track ON current_track.playlist_id = p.id AND current_track.track_id = ?
                    LEFT JOIN local_playlist_track t ON t.playlist_id = p.id
                    WHERE p.id = ? AND p.owner_id = ? AND p.is_public = 1
                    GROUP BY p.id
                    """,
                    (str(row[1]), str(row[3]), str(row[4])),
                ).fetchone()
        try:
            track = json.loads(row[0])
        except (TypeError, json.JSONDecodeError):
            return None
        track.pop("streamUrl", None)
        value: dict = {"track": track, "updatedAt": int(row[2])}
        if playlist_row is not None:
            value["playlist"] = self._playlist_row(playlist_row)
        return value, str(row[4])

    def load_public_playlist(self, username: str, playlist_id: str) -> tuple[dict, str] | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT p.id, p.title, p.description, p.cover_url, p.created_at, p.updated_at,
                       COUNT(t.track_id), COALESCE(SUM(json_extract(t.payload, '$.durationMs')), 0), p.is_public,
                       u.id
                FROM local_playlist p
                JOIN app_user u ON u.id = p.owner_id
                LEFT JOIN local_playlist_track t ON t.playlist_id = p.id
                WHERE u.username = ? COLLATE NOCASE AND p.id = ? AND p.is_public = 1
                GROUP BY p.id
                """,
                (username, playlist_id),
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
        return playlist, str(row[9])

    @staticmethod
    def _friend_pair(first: str, second: str) -> tuple[str, str]:
        return (first, second) if first < second else (second, first)

    def friend_status(self, username: str) -> str:
        viewer_id = self.current_user_id()
        with self._lock, self._connect() as connection:
            other = connection.execute(
                "SELECT id FROM app_user WHERE username = ? COLLATE NOCASE", (username,)
            ).fetchone()
            if other is None:
                raise CredentialStoreError("Пользователь не найден")
            other_id = str(other[0])
            if other_id == viewer_id:
                return "self"
            low, high = self._friend_pair(viewer_id, other_id)
            row = connection.execute(
                "SELECT requested_by, status FROM social_friend WHERE user_low_id = ? AND user_high_id = ?",
                (low, high),
            ).fetchone()
        if row is None:
            return "none"
        if str(row[1]) == "accepted":
            return "friend"
        return "outgoing" if str(row[0]) == viewer_id else "incoming"

    def request_friend(self, username: str) -> str:
        viewer_id = self.current_user_id()
        now = int(time.time())
        with self._lock, self._connect() as connection:
            other = connection.execute(
                "SELECT id FROM app_user WHERE username = ? COLLATE NOCASE", (username,)
            ).fetchone()
            if other is None:
                raise CredentialStoreError("Пользователь не найден")
            other_id = str(other[0])
            if other_id == viewer_id:
                raise CredentialStoreError("Нельзя добавить в друзья самого себя")
            low, high = self._friend_pair(viewer_id, other_id)
            existing = connection.execute(
                "SELECT requested_by, status FROM social_friend WHERE user_low_id = ? AND user_high_id = ?",
                (low, high),
            ).fetchone()
            if existing:
                if str(existing[1]) == "accepted":
                    return "friend"
                return "outgoing" if str(existing[0]) == viewer_id else "incoming"
            connection.execute(
                """
                INSERT INTO social_friend(user_low_id, user_high_id, requested_by, status, created_at, updated_at)
                VALUES(?, ?, ?, 'pending', ?, ?)
                """,
                (low, high, viewer_id, now, now),
            )
        return "outgoing"

    def accept_friend(self, username: str) -> str:
        viewer_id = self.current_user_id()
        now = int(time.time())
        with self._lock, self._connect() as connection:
            other = connection.execute(
                "SELECT id FROM app_user WHERE username = ? COLLATE NOCASE", (username,)
            ).fetchone()
            if other is None:
                raise CredentialStoreError("Пользователь не найден")
            other_id = str(other[0])
            low, high = self._friend_pair(viewer_id, other_id)
            cursor = connection.execute(
                """
                UPDATE social_friend SET status = 'accepted', updated_at = ?
                WHERE user_low_id = ? AND user_high_id = ? AND status = 'pending' AND requested_by = ?
                """,
                (now, low, high, other_id),
            )
            if cursor.rowcount != 1:
                raise CredentialStoreError("Входящая заявка не найдена")
        return "friend"

    def remove_friend(self, username: str) -> None:
        viewer_id = self.current_user_id()
        with self._lock, self._connect() as connection:
            other = connection.execute(
                "SELECT id FROM app_user WHERE username = ? COLLATE NOCASE", (username,)
            ).fetchone()
            if other is None:
                return
            low, high = self._friend_pair(viewer_id, str(other[0]))
            connection.execute(
                "DELETE FROM social_friend WHERE user_low_id = ? AND user_high_id = ?", (low, high)
            )

    def list_friends(self) -> dict[str, list[dict]]:
        viewer_id = self.current_user_id()
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT u.username, u.display_name, f.status, f.requested_by
                FROM social_friend f
                JOIN app_user u ON u.id = CASE WHEN f.user_low_id = ? THEN f.user_high_id ELSE f.user_low_id END
                WHERE f.user_low_id = ? OR f.user_high_id = ?
                ORDER BY f.updated_at DESC
                """,
                (viewer_id, viewer_id, viewer_id),
            ).fetchall()
        result: dict[str, list[dict]] = {"friends": [], "incoming": [], "outgoing": []}
        for username, display_name, status, requested_by in rows:
            relation = "friend" if status == "accepted" else ("outgoing" if requested_by == viewer_id else "incoming")
            bucket = "friends" if relation == "friend" else relation
            result[bucket].append({"username": username, "displayName": display_name, "status": relation})
        return result

    def create_social_post(
        self,
        body: str,
        visibility: str,
        attachments: list[dict],
        poll: dict | None,
    ) -> dict:
        owner_id = self.current_user_id()
        now = int(time.time())
        post_id = secrets.token_urlsafe(12)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO social_post(id, owner_id, body, visibility, attachments, poll_question, created_at, updated_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    post_id,
                    owner_id,
                    body.strip(),
                    visibility,
                    json.dumps(attachments, ensure_ascii=False, separators=(",", ":")),
                    poll.get("question") if poll else None,
                    now,
                    now,
                ),
            )
            if poll:
                for position, option in enumerate(poll.get("options", [])):
                    connection.execute(
                        "INSERT INTO social_poll_option(id, post_id, text, position) VALUES(?, ?, ?, ?)",
                        (secrets.token_urlsafe(10), post_id, str(option["text"]).strip(), position),
                    )
            row = self._social_post_row(connection, post_id, owner_id)
        if row is None:
            raise CredentialStoreError("Не удалось сохранить запись")
        return row

    def delete_social_post(self, post_id: str) -> bool:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM social_post WHERE id = ? AND owner_id = ?", (post_id, self.current_user_id())
            )
            return cursor.rowcount == 1

    def set_social_post_like(self, post_id: str, liked: bool) -> dict | None:
        viewer_id = self.current_user_id()
        with self._lock, self._connect() as connection:
            if not self._can_view_social_post(connection, post_id, viewer_id):
                return None
            if liked:
                connection.execute(
                    "INSERT OR IGNORE INTO social_post_like(post_id, user_id, created_at) VALUES(?, ?, ?)",
                    (post_id, viewer_id, int(time.time())),
                )
            else:
                connection.execute(
                    "DELETE FROM social_post_like WHERE post_id = ? AND user_id = ?", (post_id, viewer_id)
                )
            return self._social_post_row(connection, post_id, viewer_id)

    def create_social_comment(self, post_id: str, body: str, parent_id: str | None = None) -> dict:
        viewer_id = self.current_user_id()
        now = int(time.time())
        comment_id = secrets.token_urlsafe(12)
        with self._lock, self._connect() as connection:
            if not self._can_view_social_post(connection, post_id, viewer_id):
                raise CredentialStoreError("Запись не найдена")
            if parent_id is not None:
                parent = connection.execute(
                    "SELECT 1 FROM social_comment WHERE id = ? AND post_id = ?", (parent_id, post_id)
                ).fetchone()
                if parent is None:
                    raise CredentialStoreError("Родительский комментарий не найден")
            connection.execute(
                """
                INSERT INTO social_comment(id, post_id, author_id, parent_id, body, created_at, updated_at)
                VALUES(?, ?, ?, ?, ?, ?, ?)
                """,
                (comment_id, post_id, viewer_id, parent_id, body.strip(), now, now),
            )
            comment = self._social_comment_row(connection, comment_id, viewer_id)
        if comment is None:
            raise CredentialStoreError("Не удалось сохранить комментарий")
        return comment

    def list_social_comments(self, post_id: str) -> list[dict]:
        viewer_id = self.current_user_id()
        with self._lock, self._connect() as connection:
            if not self._can_view_social_post(connection, post_id, viewer_id):
                raise CredentialStoreError("Запись не найдена")
            ids = connection.execute(
                "SELECT id FROM social_comment WHERE post_id = ? ORDER BY created_at, id", (post_id,)
            ).fetchall()
            comments = [
                comment
                for row in ids
                if (comment := self._social_comment_row(connection, str(row[0]), viewer_id)) is not None
            ]
        by_id = {comment["id"]: comment for comment in comments}
        roots: list[dict] = []
        for comment in comments:
            parent = by_id.get(comment.get("parentId"))
            if parent is None:
                roots.append(comment)
            else:
                parent["replies"].append(comment)
        return roots

    def delete_social_comment(self, comment_id: str) -> bool:
        viewer_id = self.current_user_id()
        now = int(time.time())
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE social_comment
                SET body = '', deleted_at = ?, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL AND (
                    author_id = ? OR EXISTS(
                        SELECT 1 FROM social_post p WHERE p.id = social_comment.post_id AND p.owner_id = ?
                    )
                )
                """,
                (now, now, comment_id, viewer_id, viewer_id),
            )
            return cursor.rowcount == 1

    def vote_social_poll(self, post_id: str, option_id: str) -> dict | None:
        viewer_id = self.current_user_id()
        with self._lock, self._connect() as connection:
            if not self._can_view_social_post(connection, post_id, viewer_id):
                return None
            valid = connection.execute(
                "SELECT 1 FROM social_poll_option WHERE id = ? AND post_id = ?", (option_id, post_id)
            ).fetchone()
            if valid is None:
                return None
            connection.execute(
                """
                INSERT INTO social_poll_vote(post_id, option_id, user_id, created_at)
                VALUES(?, ?, ?, ?)
                ON CONFLICT(post_id, user_id) DO UPDATE SET option_id = excluded.option_id, created_at = excluded.created_at
                """,
                (post_id, option_id, viewer_id, int(time.time())),
            )
            return self._social_post_row(connection, post_id, viewer_id)

    def list_profile_posts(self, username: str, limit: int = 40) -> list[dict]:
        viewer_id = self.current_user_id()
        with self._lock, self._connect() as connection:
            owner = connection.execute(
                "SELECT id FROM app_user WHERE username = ? COLLATE NOCASE", (username,)
            ).fetchone()
            if owner is None:
                raise CredentialStoreError("Пользователь не найден")
            owner_id = str(owner[0])
            can_see_friends = owner_id == viewer_id or self._are_friends(connection, viewer_id, owner_id)
            rows = connection.execute(
                """
                SELECT id FROM social_post
                WHERE owner_id = ? AND (visibility = 'public' OR ?)
                ORDER BY created_at DESC LIMIT ?
                """,
                (owner_id, int(can_see_friends), max(1, min(limit, 100))),
            ).fetchall()
            return [post for row in rows if (post := self._social_post_row(connection, str(row[0]), viewer_id))]

    def social_feed(self, mode: str = "for-you", limit: int = 50) -> list[dict]:
        viewer_id = self.current_user_id()
        now = int(time.time())
        with self._lock, self._connect() as connection:
            friend_rows = connection.execute(
                """
                SELECT CASE WHEN user_low_id = ? THEN user_high_id ELSE user_low_id END
                FROM social_friend
                WHERE status = 'accepted' AND (user_low_id = ? OR user_high_id = ?)
                """,
                (viewer_id, viewer_id, viewer_id),
            ).fetchall()
            friend_ids = {str(row[0]) for row in friend_rows}
            rows = connection.execute(
                """
                SELECT id, owner_id, created_at FROM social_post
                WHERE visibility = 'public' OR owner_id = ?
                   OR (visibility = 'friends' AND owner_id IN (
                       SELECT CASE WHEN user_low_id = ? THEN user_high_id ELSE user_low_id END
                       FROM social_friend
                       WHERE status = 'accepted' AND (user_low_id = ? OR user_high_id = ?)
                   ))
                ORDER BY created_at DESC LIMIT 500
                """,
                (viewer_id, viewer_id, viewer_id, viewer_id),
            ).fetchall()
            taste_tracks, taste_artists = self._social_taste_profile(connection, viewer_id)
            ranked: list[tuple[float, dict]] = []
            for post_id, owner_id, created_at in rows:
                owner_id = str(owner_id)
                if mode == "friends" and owner_id != viewer_id and owner_id not in friend_ids:
                    continue
                post = self._social_post_row(connection, str(post_id), viewer_id)
                if post is None:
                    continue
                age_hours = max(0.0, (now - int(created_at)) / 3600)
                freshness = 4.0 * math.exp(-age_hours / 48.0)
                network = 3.5 if owner_id in friend_ids else (2.0 if owner_id == viewer_id else 0.0)
                affinity = self._social_attachment_affinity(post["attachments"], taste_tracks, taste_artists)
                engagement = min(2.5, math.log1p(post["likeCount"]) * 0.7)
                score = freshness + network + affinity + engagement
                if owner_id in friend_ids:
                    post["rankingReason"] = "Друг в XEDOC"
                elif affinity > 0:
                    post["rankingReason"] = "Похожий музыкальный вкус"
                elif post["likeCount"] > 1:
                    post["rankingReason"] = "Обсуждают в XEDOC"
                else:
                    post["rankingReason"] = "Свежая запись"
                ranked.append((score, post))
        ranked.sort(key=lambda item: (item[0], item[1]["createdAt"]), reverse=True)
        return [post for _, post in ranked[: max(1, min(limit, 100))]]

    @staticmethod
    def _are_friends(connection: sqlite3.Connection, first: str, second: str) -> bool:
        if first == ANONYMOUS_USER_ID or second == ANONYMOUS_USER_ID:
            return False
        low, high = CredentialStore._friend_pair(first, second)
        return connection.execute(
            "SELECT 1 FROM social_friend WHERE user_low_id = ? AND user_high_id = ? AND status = 'accepted'",
            (low, high),
        ).fetchone() is not None

    @staticmethod
    def _can_view_social_post(connection: sqlite3.Connection, post_id: str, viewer_id: str) -> bool:
        row = connection.execute(
            "SELECT owner_id, visibility FROM social_post WHERE id = ?", (post_id,)
        ).fetchone()
        if row is None:
            return False
        owner_id, visibility = str(row[0]), str(row[1])
        return visibility == "public" or owner_id == viewer_id or CredentialStore._are_friends(
            connection, viewer_id, owner_id
        )

    @staticmethod
    def _social_taste_profile(connection: sqlite3.Connection, user_id: str) -> tuple[set[str], set[str]]:
        rows = connection.execute(
            """
            SELECT track_id, payload FROM user_track_listening_stat
            WHERE user_id = ? ORDER BY play_count DESC, total_listened_ms DESC LIMIT 100
            """,
            (user_id,),
        ).fetchall()
        track_ids: set[str] = set()
        artists: set[str] = set()
        for track_id, raw_payload in rows:
            track_ids.add(str(track_id))
            try:
                payload = json.loads(str(raw_payload))
                artists.update(str(value).casefold() for value in payload.get("artists", []) if value)
            except (json.JSONDecodeError, TypeError):
                continue
        return track_ids, artists

    @staticmethod
    def _social_attachment_affinity(attachments: list[dict], track_ids: set[str], artists: set[str]) -> float:
        score = 0.0
        for attachment in attachments:
            track = attachment.get("track") if isinstance(attachment, dict) else None
            if not isinstance(track, dict):
                continue
            if str(track.get("id", "")) in track_ids:
                score = max(score, 2.5)
            elif any(str(artist).casefold() in artists for artist in track.get("artists", [])):
                score = max(score, 1.2)
        return score

    @staticmethod
    def _social_comment_row(connection: sqlite3.Connection, comment_id: str, viewer_id: str) -> dict | None:
        row = connection.execute(
            """
            SELECT c.id, c.post_id, c.parent_id, u.username, u.display_name, c.body,
                   c.created_at, c.deleted_at, c.author_id
            FROM social_comment c JOIN app_user u ON u.id = c.author_id
            WHERE c.id = ?
            """,
            (comment_id,),
        ).fetchone()
        if row is None:
            return None
        deleted = row[7] is not None
        return {
            "id": str(row[0]),
            "postId": str(row[1]),
            "parentId": str(row[2]) if row[2] is not None else None,
            "author": {"username": str(row[3]), "displayName": str(row[4])},
            "body": "Комментарий удалён" if deleted else str(row[5]),
            "createdAt": int(row[6]),
            "deleted": deleted,
            "isOwner": str(row[8]) == viewer_id,
            "replies": [],
        }

    @staticmethod
    def _social_post_row(connection: sqlite3.Connection, post_id: str, viewer_id: str) -> dict | None:
        row = connection.execute(
            """
            SELECT p.id, p.owner_id, u.username, u.display_name, p.body, p.visibility,
                   p.attachments, p.poll_question, p.created_at,
                   (SELECT COUNT(*) FROM social_post_like l WHERE l.post_id = p.id),
                   (SELECT COUNT(*) FROM social_comment c WHERE c.post_id = p.id AND c.deleted_at IS NULL),
                   EXISTS(SELECT 1 FROM social_post_like l WHERE l.post_id = p.id AND l.user_id = ?)
            FROM social_post p JOIN app_user u ON u.id = p.owner_id
            WHERE p.id = ?
            """,
            (viewer_id, post_id),
        ).fetchone()
        if row is None:
            return None
        try:
            attachments = json.loads(str(row[6]))
        except (json.JSONDecodeError, TypeError):
            attachments = []
        result = {
            "id": str(row[0]),
            "author": {"username": str(row[2]), "displayName": str(row[3])},
            "body": str(row[4]),
            "visibility": str(row[5]),
            "attachments": attachments if isinstance(attachments, list) else [],
            "createdAt": int(row[8]),
            "likeCount": int(row[9]),
            "commentCount": int(row[10]),
            "liked": bool(row[11]),
            "isOwner": str(row[1]) == viewer_id,
        }
        if row[7]:
            options = connection.execute(
                """
                SELECT o.id, o.text,
                       (SELECT COUNT(*) FROM social_poll_vote v WHERE v.option_id = o.id),
                       EXISTS(SELECT 1 FROM social_poll_vote v WHERE v.option_id = o.id AND v.user_id = ?)
                FROM social_poll_option o WHERE o.post_id = ? ORDER BY o.position
                """,
                (viewer_id, post_id),
            ).fetchall()
            result["poll"] = {
                "question": str(row[7]),
                "options": [
                    {"id": str(option[0]), "text": str(option[1]), "votes": int(option[2]), "selected": bool(option[3])}
                    for option in options
                ],
                "totalVotes": sum(int(option[2]) for option in options),
            }
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
            "isPublic": bool(row[8]) if len(row) > 8 else False,
        }
