from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.gateway import YandexMusicGateway
from app.store import Credential


def _track(identifier: str, artist: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=identifier,
        title=f"Track {identifier}",
        artists=[SimpleNamespace(id=artist, name=artist)],
        albums=[SimpleNamespace(title="Discovery")],
        duration_ms=180_000,
        cover_uri=None,
        explicit=False,
        available=True,
    )


class DiscoveryClient:
    async def users_likes_tracks(self, *, user_id):
        return SimpleNamespace(tracks=[SimpleNamespace(track_id="known-like:11")])

    async def users_playlists_list(self, *, user_id):
        return [SimpleNamespace(kind=7)]

    async def music_history(self, *, full_models_count):
        assert full_models_count == 0
        item_id = SimpleNamespace(track_id="known-history", album_id="33")
        item = SimpleNamespace(type="track", data=SimpleNamespace(item_id=item_id))
        group = SimpleNamespace(tracks=[item])
        return SimpleNamespace(history_tabs=[SimpleNamespace(items=[group])])

    async def users_playlists(self, *, kind, user_id):
        assert kind == [7]
        return [SimpleNamespace(tracks=[SimpleNamespace(track_id="known-playlist:22")])]

    async def tracks_similar(self, seed):
        assert seed in {"seed:1", "known-history:33"}
        return SimpleNamespace(similar_tracks=[
            _track("known-like", "known"),
            _track("known-local", "known"),
            _track("known-history", "known"),
            _track("fresh-one", "fresh-a"),
            _track("fresh-two", "fresh-b"),
        ])

    async def rotor_station_tracks(self, station):
        assert station == "user:onyourwave"
        return SimpleNamespace(sequence=[
            SimpleNamespace(track=_track("known-playlist", "known")),
            SimpleNamespace(track=_track("fresh-three", "fresh-c")),
        ])


def test_discovery_excludes_likes_playlists_and_listening_history(settings, monkeypatch) -> None:
    gateway = YandexMusicGateway(settings)
    client = DiscoveryClient()

    async def authorized_client(_credential):
        return client

    monkeypatch.setattr(gateway, "_authorized_client", authorized_client)
    credential = Credential(
        access_token="token",
        refresh_token=None,
        expires_at=None,
        device_id="device",
        user_uid="42",
        user_name="Test",
    )
    result = asyncio.run(gateway.discovery_recommendations(
        credential,
        ["seed:1"],
        {"known-local:99"},
    ))

    identifiers = [track.id for track in result.tracks]
    assert identifiers == ["fresh-one", "fresh-two", "fresh-three"]
    assert result.seed_count == 2
    assert result.known_track_count == 4
    assert all(track.liked is False for track in result.tracks)
