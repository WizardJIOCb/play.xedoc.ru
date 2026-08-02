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
            existing_stats = connection.execute("SELECT COUNT(*) FROM track_listening_stat").fetchone()[0]
            if not existing_stats:
                connection.execute(
                    """
                    INSERT INTO track_listening_stat(track_id, payload, play_count, total_listened_ms, last_played_at)
                    SELECT grouped.track_id,
                           (SELECT recent.payload FROM listening_event recent
                            WHERE recent.track_id = grouped.track_id AND recent.source = 'player'
                            ORDER BY recent.created_at DESC, recent.id DESC LIMIT 1),
                           grouped.play_count, grouped.total_listened_ms, grouped.last_played_at
                    FROM (
                        SELECT track_id, COUNT(*) AS play_count, SUM(listened_ms) AS total_listened_ms,
                               MAX(created_at) AS last_played_at
                        FROM listening_event WHERE source = 'player' GROUP BY track_id
                    ) grouped
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

    def create_local_playlist(self, title: str, description: str = "") -> dict:
        playlist_id = f"local-{secrets.token_urlsafe(10)}"
        now = int(time.time())
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO local_playlist(id, title, description, created_at, updated_at) VALUES(?, ?, ?, ?, ?)",
                (playlist_id, title.strip(), description.strip(), now, now),
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
                GROUP BY p.id
                ORDER BY p.updated_at DESC, p.created_at DESC
                """
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
                WHERE p.id = ? GROUP BY p.id
                """,
                (playlist_id,),
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
        values.append(playlist_id)
        with self._lock, self._connect() as connection:
            cursor = connection.execute(f"UPDATE local_playlist SET {', '.join(fields)} WHERE id = ?", values)
        return self.load_local_playlist(playlist_id) if cursor.rowcount else None

    def delete_local_playlist(self, playlist_id: str) -> dict | None:
        playlist = self.load_local_playlist(playlist_id)
        if playlist is None:
            return None
        with self._lock, self._connect() as connection:
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("DELETE FROM local_playlist WHERE id = ?", (playlist_id,))
        return playlist

    def add_local_playlist_track(self, playlist_id: str, track_id: str, payload: dict) -> dict | None:
        serialized = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        now = int(time.time())
        with self._lock, self._connect() as connection:
            exists = connection.execute("SELECT 1 FROM local_playlist WHERE id = ?", (playlist_id,)).fetchone()
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
            exists = connection.execute("SELECT 1 FROM local_playlist WHERE id = ?", (playlist_id,)).fetchone()
            if exists is None:
                return None
            connection.execute("DELETE FROM local_playlist_track WHERE playlist_id = ? AND track_id = ?", (playlist_id, track_id))
            connection.execute("UPDATE local_playlist SET updated_at = ? WHERE id = ?", (int(time.time()), playlist_id))
        return self.load_local_playlist(playlist_id)

    def save_listening_event(self, track_id: str, payload: dict, listened_ms: int, source: str = "player") -> None:
        serialized = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO listening_event(track_id, payload, source, listened_ms, created_at) VALUES(?, ?, ?, ?, ?)",
                (track_id, serialized, source, listened_ms, int(time.time())),
            )
            if source == "player":
                connection.execute(
                    """
                    INSERT INTO track_listening_stat(track_id, payload, play_count, total_listened_ms, last_played_at)
                    VALUES(?, ?, 1, ?, ?)
                    ON CONFLICT(track_id) DO UPDATE SET
                        payload = excluded.payload,
                        play_count = track_listening_stat.play_count + 1,
                        total_listened_ms = track_listening_stat.total_listened_ms + excluded.total_listened_ms,
                        last_played_at = excluded.last_played_at
                    """,
                    (track_id, serialized, listened_ms, int(time.time())),
                )
            connection.execute(
                "DELETE FROM listening_event WHERE id NOT IN (SELECT id FROM listening_event ORDER BY created_at DESC, id DESC LIMIT 30000)"
            )

    def list_listening_events(self, limit: int = 1000) -> list[dict]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT track_id, payload, source, listened_ms, created_at FROM listening_event ORDER BY created_at DESC, id DESC LIMIT ?",
                (max(1, min(limit, 30000)),),
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
                "SELECT track_id, play_count, total_listened_ms, last_played_at FROM track_listening_stat"
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
        with self._lock, self._connect() as connection:
            if days is None:
                rows = connection.execute(
                    """
                    SELECT track_id, payload, play_count, total_listened_ms, last_played_at
                    FROM track_listening_stat
                    ORDER BY play_count DESC, total_listened_ms DESC, last_played_at DESC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
            else:
                cutoff = int(time.time()) - max(1, days) * 86_400
                rows = connection.execute(
                    """
                    SELECT grouped.track_id,
                           (SELECT recent.payload FROM listening_event recent
                            WHERE recent.track_id = grouped.track_id AND recent.source = 'player' AND recent.created_at >= ?
                            ORDER BY recent.created_at DESC, recent.id DESC LIMIT 1),
                           grouped.play_count, grouped.total_listened_ms, grouped.last_played_at
                    FROM (
                        SELECT track_id, COUNT(*) AS play_count, SUM(listened_ms) AS total_listened_ms,
                               MAX(created_at) AS last_played_at
                        FROM listening_event
                        WHERE source = 'player' AND created_at >= ?
                        GROUP BY track_id
                    ) grouped
                    ORDER BY grouped.play_count DESC, grouped.total_listened_ms DESC, grouped.last_played_at DESC
                    LIMIT ?
                    """,
                    (cutoff, cutoff, limit),
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
