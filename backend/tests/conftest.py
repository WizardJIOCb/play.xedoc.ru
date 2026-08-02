from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.config import Settings
from app.gateway import DeviceAuthorization
from app.main import create_app
from app.models import (
    BootstrapPayload,
    DiscoveryRecommendationsPayload,
    LikedTracksPayload,
    PlaylistDTO,
    SearchPayload,
    SessionPayload,
    SessionPreferences,
    TrackDTO,
    UserProfileDTO,
)
from app.store import Credential, CredentialStore


TEST_TRACK = TrackDTO(
    id="101",
    title="Test Signal",
    artists=["Fixture Artist"],
    album="Fixture Album",
    duration_ms=201_000,
    cover_url="https://avatars.yandex.net/example/400x400",
    cover_tone="blue",
    liked=True,
    stream_url="/api/tracks/101/stream",
)

TEST_PLAYLIST = PlaylistDTO(
    id="42:7",
    title="Fixture Playlist",
    subtitle="A deterministic playlist",
    track_count=1,
    duration_minutes=3,
    cover_tone="violet",
    tracks=[TEST_TRACK],
)

TEST_DISCOVERY_TRACK = TrackDTO(
    id="202",
    title="Unknown Signal",
    artists=["Adjacent Artist"],
    album="Never Heard",
    duration_ms=189_000,
    cover_tone="lime",
    liked=False,
    stream_url="/api/tracks/202/stream",
)

TEST_CREDENTIAL = Credential(
    access_token="very-secret-yandex-token",
    refresh_token="secret-refresh-token",
    expires_at=None,
    device_id="xedoc-test-device",
    user_uid="42",
    user_name="Rodion Test",
)


class FakeGateway:
    def __init__(self) -> None:
        self.poll_result: Credential | None = TEST_CREDENTIAL
        self.likes: list[tuple[str, bool]] = []
        self.playlist_ids: list[str] = []
        self.search_queries: list[str] = []
        self.discovery_contexts: list[tuple[list[str], set[str]]] = []

    async def start_device_auth(self) -> DeviceAuthorization:
        return DeviceAuthorization(
            upstream_device_id="upstream-device",
            device_code="private-device-code",
            user_code="ABCD-EFGH",
            verification_url="https://ya.ru/device",
            expires_in=600,
            interval=0,
        )

    async def poll_device_auth(self, authorization: DeviceAuthorization) -> Credential | None:
        assert authorization.device_code == "private-device-code"
        return self.poll_result

    async def bootstrap(self, credential: Credential) -> BootstrapPayload:
        assert credential.access_token == TEST_CREDENTIAL.access_token
        return BootstrapPayload(
            connected=True,
            demo=False,
            access_locked=False,
            user=UserProfileDTO(name=credential.user_name),
            quick_tracks=[TEST_TRACK],
            playlists=[TEST_PLAYLIST.model_copy(update={"tracks": None})],
            recommendations=[TEST_PLAYLIST.model_copy(update={"tracks": None})],
            rediscover=[TEST_TRACK],
        )

    async def search(self, credential: Credential, query: str) -> SearchPayload:
        self.search_queries.append(query)
        return SearchPayload(tracks=[TEST_TRACK], playlists=[TEST_PLAYLIST])

    async def liked_tracks(self, credential: Credential) -> LikedTracksPayload:
        return LikedTracksPayload(tracks=[TEST_TRACK], total=1)

    async def discovery_recommendations(
        self,
        credential: Credential,
        seed_track_ids: list[str],
        exclude_track_ids: set[str],
    ) -> DiscoveryRecommendationsPayload:
        self.discovery_contexts.append((seed_track_ids, exclude_track_ids))
        return DiscoveryRecommendationsPayload(
            tracks=[TEST_DISCOVERY_TRACK],
            seed_count=len(seed_track_ids),
            known_track_count=len(exclude_track_ids),
            insight="Fixture discovery",
        )

    async def set_like(self, credential: Credential, track_id: str, liked: bool) -> None:
        self.likes.append((track_id, liked))

    async def stream_url(self, credential: Credential, track_id: str) -> str:
        assert track_id == "101"
        return "https://music.yandex.net/get-mp3/test/track.mp3"

    async def build_session(
        self, credential: Credential, preferences: SessionPreferences
    ) -> SessionPayload:
        assert preferences.duration == 50
        return SessionPayload(tracks=[TEST_TRACK])

    async def playlist(self, credential: Credential, playlist_id: str) -> PlaylistDTO:
        self.playlist_ids.append(playlist_id)
        return TEST_PLAYLIST


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        environment="test",
        access_key="test-access-key",
        cookie_secret="test-cookie-secret-that-is-long-enough",
        token_encryption_key=Fernet.generate_key().decode("ascii"),
        database_path=tmp_path / "play.db",
        cookie_secure=False,
        demo_fallback=True,
    )


@pytest.fixture
def fake_gateway() -> FakeGateway:
    return FakeGateway()


@pytest.fixture
def store(settings: Settings) -> CredentialStore:
    return CredentialStore(settings.database_path, settings.fernet_key)


@pytest.fixture
def client(
    settings: Settings,
    fake_gateway: FakeGateway,
    store: CredentialStore,
) -> Iterator[TestClient]:
    with TestClient(create_app(settings, gateway=fake_gateway, store=store)) as test_client:
        yield test_client


def unlock(client: TestClient) -> None:
    response = client.post("/api/access/unlock", json={"key": "test-access-key"})
    assert response.status_code == 200


def connect(client: TestClient) -> None:
    unlock(client)
    start = client.post("/api/auth/device/start")
    assert start.status_code == 200
    attempt_id = start.json()["deviceId"]
    response = client.post("/api/auth/device/poll", json={"deviceId": attempt_id})
    assert response.status_code == 200
    assert response.json() == {"connected": True}
