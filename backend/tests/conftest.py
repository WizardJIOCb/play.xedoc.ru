from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.config import Settings
from app.gateway import DeviceAuthorization, GatewayNotFound
from app.main import create_app
from app.models import (
    BootstrapPayload,
    DiscoveryRecommendationsPayload,
    GlobalGenreDTO,
    GlobalReleaseDTO,
    GlobalTopPayload,
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
    release_date="2026-08-29",
    duration_ms=189_000,
    cover_tone="lime",
    liked=False,
    stream_url="/api/tracks/202/stream",
)

TEST_GLOBAL_TOP = GlobalTopPayload(
    generated_at=1_700_000_000,
    edition_date="2026-08-29",
    chart_title="Мировой чарт",
    chart_description="Главные треки мира сегодня",
    chart=[TEST_TRACK, TEST_DISCOVERY_TRACK],
    releases=[GlobalReleaseDTO(
        id="release-1",
        title="Fresh Fixture",
        artists=["Fixture Artist"],
        cover_url="https://avatars.yandex.net/release/400x400",
        release_date="2026-08-29",
        genre="Electronic",
        tracks=[TEST_DISCOVERY_TRACK],
    )],
    genres=[GlobalGenreDTO(
        id="electronic",
        title="Electronic",
        scope="international",
        source_title="100 electronic hits",
        tracks=[TEST_DISCOVERY_TRACK],
    )],
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
        self.artist_queries: list[str] = []
        self.discovery_contexts: list[tuple[list[str], set[str]]] = []
        self.discovery_account_signals: list[bool] = []

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

    async def artist_tracks(self, credential: Credential, artist_name: str) -> SearchPayload:
        self.artist_queries.append(artist_name)
        return SearchPayload(tracks=[TEST_TRACK])

    async def liked_tracks(self, credential: Credential) -> LikedTracksPayload:
        return LikedTracksPayload(tracks=[TEST_TRACK], total=1)

    async def global_top(self, credential: Credential) -> GlobalTopPayload:
        assert credential.access_token == TEST_CREDENTIAL.access_token
        return TEST_GLOBAL_TOP.model_copy(deep=True)

    async def global_genre(self, credential: Credential, genre_id: str) -> GlobalGenreDTO:
        assert credential.access_token == TEST_CREDENTIAL.access_token
        genre = next((item for item in TEST_GLOBAL_TOP.genres if item.id == genre_id), None)
        if genre is None:
            raise GatewayNotFound("Genre not found")
        return genre.model_copy(deep=True)

    async def discovery_recommendations(
        self,
        credential: Credential,
        seed_track_ids: list[str],
        exclude_track_ids: set[str],
        *,
        account_signals: bool = True,
    ) -> DiscoveryRecommendationsPayload:
        self.discovery_contexts.append((seed_track_ids, exclude_track_ids))
        self.discovery_account_signals.append(account_signals)
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
    if client.get("/api/bootstrap").json().get("authenticated"):
        return
    response = client.post(
        "/api/account/register",
        json={
            "username": "testuser",
            "displayName": "Rodion Test",
            "password": "a-secure-test-password",
        },
    )
    assert response.status_code == 200


def connect(client: TestClient) -> None:
    unlock(client)
    start = client.post("/api/auth/device/start")
    assert start.status_code == 200
    attempt_id = start.json()["deviceId"]
    response = client.post("/api/auth/device/poll", json={"deviceId": attempt_id})
    assert response.status_code == 200
    assert response.json() == {"connected": True}
