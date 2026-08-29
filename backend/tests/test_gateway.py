from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.gateway import GENRE_RANKING_SPECS, YandexMusicGateway
from app.store import Credential


def _track(identifier: str, artist: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=identifier,
        title=f"Track {identifier}",
        artists=[SimpleNamespace(id=artist, name=artist)],
        albums=[SimpleNamespace(title="Discovery", release_date="2026-08-29")],
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


def test_liked_collection_marks_hydrated_track_as_liked_when_short_id_contains_album(settings, monkeypatch) -> None:
    gateway = YandexMusicGateway(settings)

    class LikedClient:
        async def users_likes_tracks(self, *, user_id):
            return SimpleNamespace(tracks=[SimpleNamespace(track_id="liked-track:77")])

        async def tracks(self, identifiers, *, with_positions):
            assert identifiers == ["liked-track:77"]
            assert with_positions is False
            return [_track("liked-track", "liked-artist")]

    async def authorized_client(_credential):
        return LikedClient()

    monkeypatch.setattr(gateway, "_authorized_client", authorized_client)
    credential = Credential(
        access_token="token",
        refresh_token=None,
        expires_at=None,
        device_id="device",
        user_uid="42",
        user_name="Test",
    )

    result = asyncio.run(gateway.liked_tracks(credential))

    assert result.total == 1
    assert result.tracks[0].id == "liked-track"
    assert result.tracks[0].liked is True


def test_artist_tracks_resolves_exact_artist_and_returns_their_catalog(settings, monkeypatch) -> None:
    gateway = YandexMusicGateway(settings)

    class ArtistClient:
        async def search(self, query, *, type_, page):
            assert (query, type_, page) == ("GUNSHIP", "artist", 0)
            artists = [
                SimpleNamespace(id=1, name="Gunship Soundtrack"),
                SimpleNamespace(id=2, name="Gunship"),
            ]
            return SimpleNamespace(artists=SimpleNamespace(results=artists))

        async def artists_tracks(self, artist_id, *, page, page_size):
            assert (artist_id, page, page_size) == (2, 0, 100)
            return SimpleNamespace(tracks=[_track("one", "GUNSHIP"), _track("two", "GUNSHIP")])

        async def users_likes_tracks(self, *, user_id):
            assert user_id == 42
            return SimpleNamespace(tracks=[])

    async def authorized_client(_credential):
        return ArtistClient()

    monkeypatch.setattr(gateway, "_authorized_client", authorized_client)
    credential = Credential(
        access_token="token",
        refresh_token=None,
        expires_at=None,
        device_id="device",
        user_uid="42",
        user_name="Test",
    )

    result = asyncio.run(gateway.artist_tracks(credential, "GUNSHIP"))

    assert [track.id for track in result.tracks] == ["one", "two"]
    assert all(track.artists == ["GUNSHIP"] for track in result.tracks)


def test_genre_rankings_keep_separate_international_and_russian_catalogs(settings) -> None:
    gateway = YandexMusicGateway(settings)

    class GenreClient:
        async def tags(self, tag_id):
            max_index = max(
                spec.playlist_index
                for spec in GENRE_RANKING_SPECS
                if spec.tag_id == tag_id
            )
            return SimpleNamespace(ids=[
                SimpleNamespace(kind=f"{tag_id}-{index}", uid="curator")
                for index in range(max_index + 1)
            ])

        async def users_playlists(self, *, kind, user_id):
            track = _track(f"track-{kind}", f"artist-{kind}")
            if (user_id, kind) == ("103372440", 1628):
                track.title = "Русский метал"
            else:
                direct_playlists = {
                    (spec.playlist_uid, spec.playlist_kind)
                    for spec in GENRE_RANKING_SPECS
                    if spec.playlist_uid is not None and spec.playlist_kind is not None
                }
                assert user_id == "curator" or (user_id, kind) in direct_playlists
            return SimpleNamespace(
                title=f"Playlist {kind}",
                tracks=[SimpleNamespace(track=track)],
            )

    rankings = asyncio.run(gateway._genre_rankings(GenreClient()))

    assert [genre.id for genre in rankings] == [spec.id for spec in GENRE_RANKING_SPECS]
    assert len([genre for genre in rankings if genre.scope == "international"]) == len([
        spec for spec in GENRE_RANKING_SPECS if spec.scope == "international"
    ])
    assert len([genre for genre in rankings if genre.scope == "russian"]) == len([
        spec for spec in GENRE_RANKING_SPECS if spec.scope == "russian"
    ])
    assert {
        "postrock",
        "shoegaze",
        "ambient",
        "lofi",
        "idm",
        "synthwave",
        "hardcorepunk",
        "posthardcore",
        "metalcore",
        "heavyhardcore",
    }.issubset({genre.id for genre in rankings})
    assert next(genre for genre in rankings if genre.id == "metal").source_title == "Playlist metal-1"
    assert next(genre for genre in rankings if genre.id == "postrock").source_title == "Playlist 1022"
    assert next(genre for genre in rankings if genre.id == "heavyhardcore").source_title == "Playlist 20456"
    assert next(genre for genre in rankings if genre.id == "rusmetal").tracks[0].title == "Русский метал"
    assert next(genre for genre in rankings if genre.id == "ruspunk").tracks[0].id == "track-punk-1"


def test_global_genre_returns_the_full_source_playlist(settings) -> None:
    gateway = YandexMusicGateway(settings)

    class FullGenreClient:
        async def tags(self, tag_id):
            assert tag_id == "rock"
            return SimpleNamespace(ids=[SimpleNamespace(kind="rock-full", uid="curator")])

        async def users_playlists(self, *, kind, user_id):
            assert (kind, user_id) == ("rock-full", "curator")
            return SimpleNamespace(
                title="Полный рок-рейтинг",
                tracks=[SimpleNamespace(track=_track(f"rock-{index}", "Rock Artist")) for index in range(35)],
            )

    async def authorized_client(_credential):
        return FullGenreClient()

    gateway._authorized_client = authorized_client
    credential = Credential(
        access_token="token",
        refresh_token=None,
        expires_at=None,
        device_id="device",
        user_uid="42",
        user_name="Test",
    )

    result = asyncio.run(gateway.global_genre(credential, "rock"))

    assert result.title == "Рок"
    assert result.source_title == "Полный рок-рейтинг"
    assert len(result.tracks) == 35
    assert result.tracks[-1].id == "rock-34"
