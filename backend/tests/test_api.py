from __future__ import annotations

import base64
import sqlite3
import time
from dataclasses import replace

from fastapi.testclient import TestClient

from app.store import LEGACY_USER_ID, CredentialStore

from .conftest import FakeGateway, TEST_CREDENTIAL, TEST_TRACK, connect, unlock


def seed_shared_catalog(store: CredentialStore) -> None:
    token = store.set_current_user(LEGACY_USER_ID)
    try:
        store.save(TEST_CREDENTIAL)
        store.save_listening_event(
            TEST_TRACK.id,
            TEST_TRACK.model_dump(by_alias=True, exclude_none=True),
            20_000,
        )
    finally:
        store.reset_current_user(token)


def test_health_is_public(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["storage"] == "ok"


def test_health_returns_503_when_storage_is_unhealthy(
    client: TestClient,
    store: CredentialStore,
    monkeypatch,
) -> None:
    monkeypatch.setattr(store, "healthy", lambda: False)
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["status"] == "degraded"


def test_guest_and_authenticated_shared_catalog_bootstrap(client: TestClient, store: CredentialStore) -> None:
    empty_guest = client.get("/api/bootstrap")
    assert empty_guest.status_code == 200
    assert empty_guest.json()["accessLocked"] is False
    assert empty_guest.json()["authenticated"] is False
    assert empty_guest.json()["quickTracks"] == []
    assert "appUser" not in empty_guest.json()
    assert "access_locked" not in empty_guest.json()

    denied = client.post("/api/account/login", json={"username": "nobody", "password": "wrong-password"})
    assert denied.status_code == 401

    seed_shared_catalog(store)
    guest = client.get("/api/bootstrap")
    assert guest.status_code == 200
    assert guest.json()["authenticated"] is False
    assert guest.json()["likedTracks"] == []
    assert guest.json()["likedCount"] == 0
    assert "liked" not in guest.json()["quickTracks"][0]
    assert guest.json()["quickTracks"][0]["streamUrl"].startswith("/api/public-search/tracks/101/stream?ticket=")
    assert guest.json()["recommendations"][0]["tracks"][0]["streamUrl"].startswith("/api/public-search/tracks/101/stream?ticket=")

    unlock(client)
    catalog = client.get("/api/bootstrap")
    assert catalog.status_code == 200
    assert catalog.json()["accessLocked"] is False
    assert catalog.json()["authenticated"] is True
    assert catalog.json()["appUser"]["username"] == "testuser"
    assert catalog.json()["connected"] is False
    assert catalog.json()["demo"] is False
    assert catalog.json()["catalogAvailable"] is True
    assert catalog.json()["quickTracks"][0]["id"] == "101"
    assert catalog.json()["recommendations"][0]["tracks"][0]["id"] == "101"


def test_guest_can_open_and_stream_public_top_tracks(client: TestClient, fake_gateway) -> None:
    connect(client)
    listened = client.post("/api/listening-events", json={
        "track": {"id": "101", "title": "Test Signal", "artists": ["Fixture Artist"], "durationMs": 201_000},
        "listenedMs": 20_000,
    })
    assert listened.status_code == 200

    client.cookies.clear()
    stats = client.get("/api/listening-stats")
    assert stats.status_code == 200
    body = stats.json()
    assert body["totalPlays"] == 1
    assert body["uniqueTracks"] == 1
    assert body["top"][0]["tracks"][0]["id"] == "101"
    assert "liked" not in body["top"][0]["tracks"][0]
    stream_path = body["top"][0]["tracks"][0]["streamUrl"]
    assert stream_path.startswith("/api/public-search/tracks/101/stream?ticket=")

    stream = client.get(stream_path, follow_redirects=False)
    assert stream.status_code == 307
    assert stream.headers["location"] == "https://music.yandex.net/get-mp3/test/track.mp3"


def test_global_top_is_public_and_uses_signed_catalog_streams(
    client: TestClient,
    store: CredentialStore,
) -> None:
    seed_shared_catalog(store)

    response = client.get("/api/global-top")

    assert response.status_code == 200
    body = response.json()
    assert body["chartTitle"] == "Мировой чарт"
    assert body["editionDate"] == "2026-08-29"
    assert [track["id"] for track in body["chart"]] == ["101", "202"]
    assert body["releases"][0]["title"] == "Fresh Fixture"
    assert body["genres"][0]["title"] == "Electronic"
    assert body["genres"][0]["scope"] == "international"
    assert body["genres"][0]["sourceTitle"] == "100 electronic hits"
    assert "liked" not in body["chart"][0]
    assert body["chart"][0]["streamUrl"].startswith("/api/public-search/tracks/101/stream?ticket=")

    unlock(client)
    authenticated = client.get("/api/global-top")
    assert authenticated.status_code == 200
    assert authenticated.json()["chart"][0]["streamUrl"] == "/api/tracks/101/stream"


def test_album_page_is_public_and_uses_an_exact_album_identifier(
    client: TestClient,
    store: CredentialStore,
    fake_gateway: FakeGateway,
) -> None:
    seed_shared_catalog(store)

    response = client.get("/api/albums", params={
        "id": "fixture-album-1",
        "title": "Fixture Album",
        "artist": "Fixture Artist",
    })

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "fixture-album-1"
    assert body["title"] == "Fixture Album"
    assert body["tracks"][0]["albumId"] == "fixture-album-1"
    assert body["tracks"][0]["streamUrl"].startswith("/api/public-search/tracks/101/stream?ticket=")
    assert "liked" not in body["tracks"][0]
    assert fake_gateway.album_queries == [("fixture-album-1", "Fixture Album", "Fixture Artist")]


def test_global_top_sections_are_public_and_paginated(
    client: TestClient,
    store: CredentialStore,
) -> None:
    seed_shared_catalog(store)

    chart = client.get("/api/global-top/section", params={"kind": "chart", "offset": 0, "limit": 1})
    assert chart.status_code == 200
    assert chart.json()["title"] == "Мировой чарт"
    assert chart.json()["total"] == 2
    assert chart.json()["hasMore"] is True
    assert [track["id"] for track in chart.json()["tracks"]] == ["101"]
    assert chart.json()["tracks"][0]["streamUrl"].startswith("/api/public-search/tracks/101/stream?ticket=")

    next_chart = client.get("/api/global-top/section", params={"kind": "chart", "offset": 1, "limit": 1})
    assert [track["id"] for track in next_chart.json()["tracks"]] == ["202"]
    assert next_chart.json()["hasMore"] is False

    genre = client.get("/api/global-top/section", params={"kind": "genre", "id": "electronic", "limit": 20})
    assert genre.status_code == 200
    assert genre.json()["title"] == "Electronic"
    assert genre.json()["description"] == "По порядку в подборке «100 electronic hits»"
    assert [track["id"] for track in genre.json()["tracks"]] == ["202"]
    assert genre.json()["tracks"][0]["releaseDate"] == "2026-08-29"

    modern = client.get("/api/global-top/section", params={"kind": "genre", "id": "electronic", "period": "2020s"})
    assert modern.status_code == 200
    assert modern.json()["total"] == 1
    assert [track["id"] for track in modern.json()["tracks"]] == ["202"]

    classic = client.get("/api/global-top/section", params={"kind": "genre", "id": "electronic", "period": "classic"})
    assert classic.status_code == 200
    assert classic.json()["total"] == 0
    assert classic.json()["tracks"] == []

    missing = client.get("/api/global-top/section", params={"kind": "genre", "id": "missing"})
    assert missing.status_code == 404


def test_profile_search_accepts_at_username(client: TestClient, fake_gateway: FakeGateway) -> None:
    connect(client)
    response = client.get("/api/search", params={"q": "@testuser"})
    assert response.status_code == 200
    assert response.json()["profiles"][0]["username"] == "testuser"
    assert fake_gateway.search_queries[-1] == "testuser"


def test_admin_dashboard_requires_role_and_aggregates_service_data(
    client: TestClient,
    store: CredentialStore,
) -> None:
    connect(client)
    denied = client.get("/api/admin/dashboard")
    assert denied.status_code == 403

    assert store.set_user_admin("@testuser", True) is True
    with sqlite3.connect(store.path) as connection:
        connection.execute(
            "UPDATE app_user SET created_at = ? WHERE username = ?",
            (1_700_000_000, "wizardjiocb911"),
        )
        connection.execute(
            "UPDATE app_user SET created_at = ? WHERE username = ?",
            (1_600_000_000, "testuser"),
        )
    created = client.post("/api/local-playlists", json={"title": "Admin fixture", "isPublic": True})
    assert created.status_code == 200
    listened = client.post("/api/listening-events", json={
        "track": {"id": "101", "title": "Test Signal", "artists": ["Fixture Artist"], "durationMs": 201_000},
        "listenedMs": 20_000,
    })
    assert listened.status_code == 200

    dashboard = client.get("/api/admin/dashboard")
    assert dashboard.status_code == 200
    body = dashboard.json()
    assert body["summary"]["usersTotal"] == 2
    assert body["summary"]["yandexConnected"] == 1
    assert body["summary"]["playlistsTotal"] == 1
    assert body["summary"]["publicPlaylists"] == 1
    assert body["summary"]["totalPlays"] == 1
    assert [user["username"] for user in body["users"]] == ["wizardjiocb911", "testuser"]
    assert body["users"][1]["isAdmin"] is True
    assert body["topTracks"][0]["id"] == "101"

    filtered = client.get("/api/admin/dashboard", params={"q": "@testuser"})
    assert [user["username"] for user in filtered.json()["users"]] == ["testuser"]


def test_device_flow_connects_and_persists_encrypted_token(
    client: TestClient,
    store: CredentialStore,
) -> None:
    unlock(client)
    start = client.post("/api/auth/device/start")
    assert start.status_code == 200
    body = start.json()
    assert set(body) == {"deviceId", "userCode", "verificationUrl", "expiresIn", "interval"}
    assert body["userCode"] == "ABCD-EFGH"
    assert "private-device-code" not in str(body)

    poll = client.post("/api/auth/device/poll", json={"deviceId": body["deviceId"]})
    assert poll.status_code == 200
    assert poll.json() == {"connected": True}

    user = store.user_by_username("testuser")
    assert user is not None
    encrypted = store.encrypted_payload(user.id)
    assert encrypted is not None
    assert TEST_CREDENTIAL.access_token.encode() not in encrypted
    assert TEST_CREDENTIAL.refresh_token.encode() not in encrypted
    assert store.load_for_user(user.id) == TEST_CREDENTIAL

    bootstrap = client.get("/api/bootstrap")
    assert bootstrap.status_code == 200
    payload = bootstrap.json()
    assert payload["connected"] is True
    assert payload["user"]["name"] == "Rodion Test"
    assert payload["quickTracks"][0]["durationMs"] == 201_000
    assert "tracks" not in payload["playlists"][0]


def test_connected_music_endpoints(
    client: TestClient,
    fake_gateway: FakeGateway,
) -> None:
    connect(client)

    search = client.get("/api/search", params={"q": "signal"})
    assert search.status_code == 200
    assert search.json()["tracks"][0]["streamUrl"] == "/api/tracks/101/stream"

    liked = client.put("/api/tracks/101/like", json={"track": TEST_TRACK.model_dump(by_alias=True, exclude_none=True)})
    unliked = client.delete("/api/tracks/101/like")
    assert liked.json() == {"ok": True}
    assert unliked.json() == {"ok": True}
    assert fake_gateway.likes == [("101", True), ("101", False)]

    stream = client.get("/api/tracks/101/stream", follow_redirects=False)
    assert stream.status_code == 307
    assert stream.headers["location"] == "https://music.yandex.net/get-mp3/test/track.mp3"
    assert stream.headers["cache-control"] == "private, no-store, max-age=0"

    playlist = client.get("/api/playlists/42%3A7")
    assert playlist.status_code == 200
    assert playlist.json()["tracks"][0]["id"] == "101"
    assert fake_gateway.playlist_ids == ["42:7"]

    session = client.post(
        "/api/sessions/build",
        json={"duration": 50, "discovery": 58, "cooldownDays": 30, "source": "all"},
    )
    assert session.status_code == 200
    assert session.json()["tracks"][0]["title"] == "Test Signal"


def test_local_playlist_crud_cover_tracks_and_learning(client: TestClient, fake_gateway) -> None:
    connect(client)
    created = client.post("/api/local-playlists", json={"title": "My XEDOC list", "description": "See https://example.com"})
    assert created.status_code == 200
    playlist_id = created.json()["id"]
    assert created.json()["local"] is True

    added = client.post(f"/api/local-playlists/{playlist_id}/tracks", json={"track": {
        "id": "101", "title": "Test Signal", "artists": ["Fixture Artist"], "durationMs": 201_000,
    }})
    assert added.status_code == 200
    assert added.json()["trackCount"] == 1
    assert added.json()["tracks"][0]["id"] == "101"
    assert client.get("/api/tracks/101/play-count").json() == {"playCount": 0}

    image = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"x" * 40).decode()
    covered = client.put(f"/api/local-playlists/{playlist_id}/cover", json={"dataUrl": image})
    assert covered.status_code == 200
    assert covered.json()["coverUrl"] == image

    listened = client.post("/api/listening-events", json={
        "track": {"id": "101", "title": "Test Signal", "artists": ["Fixture Artist"], "durationMs": 201_000},
        "listenedMs": 20_000,
    })
    assert listened.json() == {"ok": True}
    assert client.get("/api/tracks/101/play-count").json() == {"playCount": 1}
    bootstrap = client.get("/api/bootstrap").json()
    assert bootstrap["localPlaylists"][0]["id"] == playlist_id
    assert bootstrap["xedocRecommendations"][0]["id"] == "101"
    assert bootstrap["xedocRecommendations"][0]["playCount"] == 1
    assert "сигналов" in bootstrap["recommendationInsight"]
    assert [item["periodDays"] for item in bootstrap["xedocCollections"]] == [1, 3, 7, 30]
    assert bootstrap["xedocCollections"][0]["signalCount"] == 1
    assert bootstrap["xedocCollections"][0]["fallback"] is False
    assert bootstrap["xedocCollections"][0]["tracks"][0]["id"] == "101"

    stats = client.get("/api/listening-stats")
    assert stats.status_code == 200
    assert stats.json()["totalPlays"] == 1
    assert stats.json()["uniqueTracks"] == 1
    assert stats.json()["top"][0]["tracks"][0]["playCount"] == 1
    assert stats.json()["top"][-1]["id"] == "all-time"

    liked_tracks = client.get("/api/liked-tracks")
    assert liked_tracks.status_code == 200
    assert liked_tracks.json()["total"] == 1
    assert liked_tracks.json()["tracks"][0]["id"] == "101"
    assert liked_tracks.json()["tracks"][0]["liked"] is True

    discovery = client.get("/api/discovery-recommendations")
    assert discovery.status_code == 200
    assert discovery.json()["tracks"][0]["id"] == "202"
    assert discovery.json()["seedCount"] == 1
    assert fake_gateway.discovery_contexts[-1][0] == ["101"]
    assert "101" in fake_gateway.discovery_contexts[-1][1]
    assert fake_gateway.discovery_account_signals[-1] is True

    shared = client.post("/api/shares/playlists", json={"playlistId": playlist_id})
    assert shared.status_code == 200
    removed = client.delete(f"/api/local-playlists/{playlist_id}/tracks/101")
    assert removed.json()["trackCount"] == 0
    assert client.delete(f"/api/local-playlists/{playlist_id}").json() == {"ok": True}


def test_public_profile_exposes_only_explicitly_public_playlists(client: TestClient) -> None:
    connect(client)
    private = client.post("/api/local-playlists", json={"title": "Private notes"}).json()
    public = client.post(
        "/api/local-playlists",
        json={"title": "Open signals", "description": "For everyone", "isPublic": True},
    ).json()
    assert private["isPublic"] is False
    assert public["isPublic"] is True

    added = client.post(f"/api/local-playlists/{public['id']}/tracks", json={"track": {
        "id": "101", "title": "Test Signal", "artists": ["Fixture Artist"], "durationMs": 201_000,
    }})
    assert added.status_code == 200
    listened = client.post("/api/listening-events", json={
        "track": {"id": "101", "title": "Test Signal", "artists": ["Fixture Artist"], "durationMs": 201_000},
        "listenedMs": 20_000,
    })
    assert listened.status_code == 200

    client.cookies.clear()
    search = client.get("/api/profiles/search", params={"q": "test"})
    assert search.status_code == 200
    assert search.json()[0] == {
        "username": "testuser", "displayName": "Rodion Test", "publicPlaylistCount": 1,
    }

    profile = client.get("/api/profiles/testuser")
    assert profile.status_code == 200
    body = profile.json()
    assert body["publicPlaylistCount"] == 1
    assert [item["title"] for item in body["playlists"]] == ["Open signals"]
    assert body["stats"] == {"totalPlays": 1, "uniqueTracks": 1, "totalListenedMs": 20_000}
    assert body["topTracks"][0]["playCount"] == 1
    top_stream_path = body["topTracks"][0]["streamUrl"]
    assert top_stream_path == "/api/profiles/testuser/top-tracks/101/stream"
    top_stream = client.get(top_stream_path, follow_redirects=False)
    assert top_stream.status_code == 307
    assert top_stream.headers["location"] == "https://music.yandex.net/get-mp3/test/track.mp3"
    assert client.get("/api/profiles/testuser/top-tracks/unknown/stream").status_code == 404

    playlist = client.get(f"/api/profiles/testuser/playlists/{public['id']}")
    assert playlist.status_code == 200
    stream_path = playlist.json()["tracks"][0]["streamUrl"]
    stream = client.get(stream_path, follow_redirects=False)
    assert stream.status_code == 307
    assert stream.headers["location"] == "https://music.yandex.net/get-mp3/test/track.mp3"

    hidden = client.get(f"/api/profiles/testuser/playlists/{private['id']}")
    assert hidden.status_code == 404


def test_now_playing_is_live_playable_and_never_reveals_a_private_playlist(
    client: TestClient,
    store: CredentialStore,
) -> None:
    connect(client)
    public = client.post("/api/local-playlists", json={"title": "Live mix", "isPublic": True}).json()
    private = client.post("/api/local-playlists", json={"title": "Secret mix"}).json()
    track = {
        "id": "101", "title": "Test Signal", "artists": ["Fixture Artist"],
        "durationMs": 201_000, "liked": True, "streamUrl": "/api/tracks/101/stream",
    }
    for playlist in (public, private):
        assert client.post(f"/api/local-playlists/{playlist['id']}/tracks", json={"track": track}).status_code == 200

    live = client.put("/api/presence/now-playing", json={"track": track, "playlistId": public["id"]})
    assert live.status_code == 200
    client.cookies.clear()

    now_playing = client.get("/api/profiles/testuser/now-playing")
    assert now_playing.status_code == 200
    body = now_playing.json()
    assert body["track"]["id"] == "101"
    assert body["playlist"]["title"] == "Live mix"
    assert "liked" not in body["track"]
    stream = client.get(body["track"]["streamUrl"], follow_redirects=False)
    assert stream.status_code == 307

    assert client.post("/api/account/login", json={"username": "testuser", "password": "a-secure-test-password"}).status_code == 200
    assert client.put("/api/presence/now-playing", json={"track": track, "playlistId": private["id"]}).status_code == 200
    client.cookies.clear()
    private_live = client.get("/api/profiles/testuser").json()["nowPlaying"]
    assert private_live["track"]["id"] == "101"
    assert "playlist" not in private_live

    with sqlite3.connect(store.path) as connection:
        connection.execute("UPDATE user_now_playing SET updated_at = updated_at - 1000")
    assert client.get("/api/profiles/testuser/now-playing").json() is None

    assert client.post("/api/account/login", json={"username": "testuser", "password": "a-secure-test-password"}).status_code == 200
    assert client.delete("/api/presence/now-playing").status_code == 200


def test_playlist_visibility_can_be_changed_by_owner(client: TestClient) -> None:
    unlock(client)
    created = client.post("/api/local-playlists", json={"title": "Visibility"}).json()
    assert client.get("/api/profiles/testuser").json()["publicPlaylistCount"] == 0
    updated = client.patch(f"/api/local-playlists/{created['id']}", json={"isPublic": True})
    assert updated.status_code == 200
    assert updated.json()["isPublic"] is True
    assert client.get("/api/profiles/testuser").json()["publicPlaylistCount"] == 1
    hidden = client.patch(f"/api/local-playlists/{created['id']}", json={"isPublic": False})
    assert hidden.json()["isPublic"] is False
    assert client.get("/api/profiles/testuser").json()["publicPlaylistCount"] == 0


def test_vk_import_matches_catalog_and_seeds_preferences(client: TestClient) -> None:
    connect(client)
    imported = client.post("/api/import/vk", json={
        "sourceUrl": "https://vk.ru/audios145429079",
        "tracks": [{"title": "Test Signal", "artist": "Fixture Artist", "duration": "3:21"}],
    })
    assert imported.status_code == 200
    body = imported.json()
    assert body["matched"] == 1
    assert body["unmatched"] == []
    assert body["playlist"]["title"] == "Музыка из VK"
    assert body["playlist"]["tracks"][0]["id"] == "101"
    bootstrap = client.get("/api/bootstrap").json()
    assert "сигналов" in bootstrap["recommendationInsight"]
    assert bootstrap["xedocCollections"][0]["fallback"] is True


def test_track_share_is_public_and_only_streams_the_shared_track(
    client: TestClient,
) -> None:
    connect(client)
    created = client.post(
        "/api/shares/tracks",
        json={"track": {
            "id": "101",
            "title": "Test Signal",
            "artists": ["Fixture Artist"],
            "album": "Fixture Album",
            "durationMs": 201_000,
            "coverUrl": "https://avatars.yandex.net/example/400x400",
            "liked": True,
            "streamUrl": "/api/tracks/101/stream",
        }},
    )
    assert created.status_code == 200
    token = created.json()["token"]
    assert created.json()["path"] == f"/share/{token}"

    client.cookies.clear()
    public = client.get(f"/api/shares/{token}")
    assert public.status_code == 200
    assert public.json()["kind"] == "track"
    assert public.json()["sharedBy"] == "Rodion Test"
    assert public.json()["track"]["streamUrl"] == f"/api/shares/{token}/tracks/101/stream"
    assert "liked" not in public.json()["track"]

    stream = client.get(public.json()["track"]["streamUrl"], follow_redirects=False)
    assert stream.status_code == 307
    assert stream.headers["location"] == "https://music.yandex.net/get-mp3/test/track.mp3"
    denied = client.get(f"/api/shares/{token}/tracks/999/stream", follow_redirects=False)
    assert denied.status_code == 404


def test_playlist_share_is_public_and_reuses_its_link(
    client: TestClient,
    fake_gateway: FakeGateway,
) -> None:
    connect(client)
    first = client.post("/api/shares/playlists", json={"playlistId": "42:7"})
    second = client.post("/api/shares/playlists", json={"playlistId": "42:7"})
    assert first.status_code == 200
    assert second.json()["token"] == first.json()["token"]
    assert fake_gateway.playlist_ids[-2:] == ["42:7", "42:7"]

    token = first.json()["token"]
    client.cookies.clear()
    public = client.get(f"/api/shares/{token}")
    assert public.status_code == 200
    assert public.json()["kind"] == "playlist"
    assert public.json()["playlist"]["title"] == "Fixture Playlist"
    assert public.json()["playlist"]["tracks"][0]["streamUrl"] == f"/api/shares/{token}/tracks/101/stream"


def test_share_creation_requires_connected_owner(client: TestClient) -> None:
    unlock(client)
    response = client.post(
        "/api/shares/tracks",
        json={"track": {
            "id": "101",
            "title": "Test Signal",
            "artists": ["Fixture Artist"],
            "durationMs": 201_000,
        }},
    )
    assert response.status_code == 401
    assert client.get("/api/shares/not-a-real-token").status_code == 404


def test_shared_catalog_search_session_playlist_and_likes(
    client: TestClient,
    store: CredentialStore,
    fake_gateway: FakeGateway,
) -> None:
    seed_shared_catalog(store)
    unlock(client)
    search = client.get("/api/search", params={"q": "signal"})
    assert search.status_code == 200
    track = search.json()["tracks"][0]
    assert track["title"] == "Test Signal"
    assert track["liked"] is False

    liked = client.put("/api/tracks/101/like", json={"track": track})
    assert liked.status_code == 200
    favorites = client.get("/api/liked-tracks").json()
    assert favorites["total"] == 1
    assert favorites["tracks"][0]["id"] == "101"
    assert client.get("/api/search", params={"q": "signal"}).json()["tracks"][0]["liked"] is True

    session = client.post(
        "/api/sessions/build",
        json={
            "duration": 25,
            "discovery": 50,
            "cooldownDays": 7,
            "source": "liked",
            "excludeTrackIds": [],
        },
    )
    assert session.status_code == 200
    assert session.json()["tracks"]
    assert session.json()["tracks"][0]["id"] == "101"

    playlist_id = search.json()["playlists"][0]["id"]
    playlist = client.get(f"/api/playlists/{playlist_id}")
    assert playlist.status_code == 200
    assert playlist.json()["tracks"]

    stream = client.get("/api/tracks/101/stream", follow_redirects=False)
    assert stream.status_code == 307

    listened = client.post("/api/listening-events", json={
        "track": track,
        "listenedMs": 20_000,
    })
    assert listened.status_code == 200
    assert client.get("/api/listening-stats").json()["totalPlays"] == 1
    assert "сигналов" in client.get("/api/bootstrap").json()["recommendationInsight"]

    discovery = client.get("/api/discovery-recommendations")
    assert discovery.status_code == 200
    assert fake_gateway.discovery_account_signals[-1] is False


def test_logout_clears_music_session(client: TestClient, store: CredentialStore) -> None:
    connect(client)
    user = store.user_by_username("testuser")
    assert user is not None
    assert store.load_for_user(user.id) is not None
    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200
    assert logout.json() == {"ok": True}
    assert store.load_for_user(user.id) is None
    assert client.get("/api/bootstrap").json()["connected"] is False


def test_account_logout_invalidates_app_session_without_deleting_music(client: TestClient, store: CredentialStore) -> None:
    connect(client)
    user = store.user_by_username("testuser")
    assert user is not None
    assert client.post("/api/account/logout").status_code == 200
    assert client.get("/api/bootstrap").json()["authenticated"] is False
    assert store.load_for_user(user.id) is not None
    logged_in = client.post(
        "/api/account/login",
        json={"username": "testuser", "password": "a-secure-test-password"},
    )
    assert logged_in.status_code == 200
    assert client.get("/api/bootstrap").json()["connected"] is True


def test_first_connected_yandex_uid_is_pinned(
    client: TestClient,
    fake_gateway: FakeGateway,
) -> None:
    connect(client)
    assert client.post("/api/auth/logout").status_code == 200
    fake_gateway.poll_result = replace(TEST_CREDENTIAL, user_uid="99", session_id="")

    start = client.post("/api/auth/device/start")
    response = client.post(
        "/api/auth/device/poll",
        json={"deviceId": start.json()["deviceId"]},
    )
    assert response.status_code == 401
    assert "другому Яндекс-аккаунту" in response.json()["detail"]


def test_private_endpoints_require_access(client: TestClient) -> None:
    assert client.post("/api/auth/device/start").status_code == 401
    assert client.get("/api/search", params={"q": "test"}).status_code == 200
    assert client.put("/api/tracks/101/like").status_code == 401


def test_public_search_uses_signed_guest_stream(
    client: TestClient,
    fake_gateway: FakeGateway,
) -> None:
    connect(client)
    assert client.post("/api/account/logout").status_code == 200

    search = client.get("/api/search", params={"q": "signal"})
    assert search.status_code == 200
    payload = search.json()
    assert payload["playlists"] == []
    assert "liked" not in payload["tracks"][0]
    stream_path = payload["tracks"][0]["streamUrl"]
    assert stream_path.startswith("/api/public-search/tracks/101/stream?ticket=")

    stream = client.get(stream_path, follow_redirects=False)
    assert stream.status_code == 307
    assert stream.headers["location"] == "https://music.yandex.net/get-mp3/test/track.mp3"
    assert stream.headers["cache-control"] == "public, no-store, max-age=0"
    assert fake_gateway.search_queries[-1] == "signal"

    artist_search = client.get("/api/search", params={"q": "Fixture Artist", "artist": "true"})
    assert artist_search.status_code == 200
    assert artist_search.json()["playlists"] == []
    assert artist_search.json()["tracks"][0]["streamUrl"].startswith("/api/public-search/tracks/101/stream?ticket=")
    assert fake_gateway.artist_queries[-1] == "Fixture Artist"

    separator = "&" if "?" in stream_path else "?"
    rejected = client.get(f"{stream_path}{separator}ticket=invalid-ticket-value", follow_redirects=False)
    assert rejected.status_code == 403


def test_registration_login_and_tenant_isolation(client: TestClient, store: CredentialStore) -> None:
    unlock(client)
    first_user = store.user_by_username("testuser")
    assert first_user is not None
    playlist = client.post("/api/local-playlists", json={"title": "Only mine"})
    assert playlist.status_code == 200

    assert client.post("/api/account/logout").status_code == 200
    registered = client.post(
        "/api/account/register",
        json={
            "username": "second-user",
            "displayName": "Second listener",
            "password": "another-secure-password",
        },
    )
    assert registered.status_code == 200
    second_bootstrap = client.get("/api/bootstrap").json()
    assert second_bootstrap["connected"] is False
    assert second_bootstrap.get("localPlaylists", []) == []

    assert client.post("/api/account/logout").status_code == 200
    logged_in = client.post(
        "/api/account/login",
        json={"username": "testuser", "password": "a-secure-test-password"},
    )
    assert logged_in.status_code == 200
    first_bootstrap = client.get("/api/bootstrap").json()
    assert first_bootstrap["localPlaylists"][0]["title"] == "Only mine"


def test_social_posts_support_rich_blocks_likes_and_polls(client: TestClient) -> None:
    unlock(client)
    created = client.post(
        "/api/social/posts",
        json={
            "body": "Что включить вечером?",
            "visibility": "public",
            "attachments": [
                {"kind": "link", "url": "https://example.com/review", "title": "Рецензия"},
                {"kind": "track", "track": {
                    "id": "101", "title": "Test Signal", "artists": ["Fixture Artist"], "durationMs": 201_000,
                    "liked": True,
                }},
            ],
            "poll": {"question": "Ваш выбор?", "options": [{"text": "Первый"}, {"text": "Второй"}]},
        },
    )
    assert created.status_code == 200
    post = created.json()
    assert post["attachments"][1]["track"]["streamUrl"] == "/api/tracks/101/stream"
    assert "liked" not in post["attachments"][1]["track"]

    liked = client.put(f"/api/social/posts/{post['id']}/like")
    assert liked.status_code == 200
    assert liked.json()["liked"] is True
    assert liked.json()["likeCount"] == 1

    option_id = post["poll"]["options"][0]["id"]
    voted = client.post(f"/api/social/posts/{post['id']}/vote", json={"optionId": option_id})
    assert voted.status_code == 200
    assert voted.json()["poll"]["totalVotes"] == 1
    assert voted.json()["poll"]["options"][0]["selected"] is True

    feed = client.get("/api/social/feed")
    assert feed.status_code == 200
    assert feed.json()["algorithm"] == "xedoc-social-v1"
    assert feed.json()["posts"][0]["id"] == post["id"]
    assert feed.json()["posts"][0]["rankingReason"]

    client.cookies.clear()
    public_wall = client.get("/api/social/profiles/testuser/posts")
    assert public_wall.status_code == 200
    assert public_wall.json()[0]["liked"] is False


def test_social_comments_support_nested_replies_and_collapsed_branches(client: TestClient) -> None:
    unlock(client)
    post = client.post(
        "/api/social/posts",
        json={"body": "Обсудим этот трек", "visibility": "public"},
    ).json()

    root = client.post(
        f"/api/social/posts/{post['id']}/comments",
        json={"body": "Первый комментарий"},
    )
    assert root.status_code == 200
    reply = client.post(
        f"/api/social/posts/{post['id']}/comments",
        json={"body": "Ответ на комментарий", "parentId": root.json()["id"]},
    )
    assert reply.status_code == 200
    nested = client.post(
        f"/api/social/posts/{post['id']}/comments",
        json={"body": "Ответ на ответ", "parentId": reply.json()["id"]},
    )
    assert nested.status_code == 200

    comments = client.get(f"/api/social/posts/{post['id']}/comments")
    assert comments.status_code == 200
    tree = comments.json()
    assert tree[0]["body"] == "Первый комментарий"
    assert tree[0]["replies"][0]["body"] == "Ответ на комментарий"
    assert tree[0]["replies"][0]["replies"][0]["body"] == "Ответ на ответ"

    feed_post = client.get("/api/social/feed").json()["posts"][0]
    assert feed_post["commentCount"] == 3

    deleted = client.delete(f"/api/social/comments/{reply.json()['id']}")
    assert deleted.status_code == 200
    tree_after_delete = client.get(f"/api/social/posts/{post['id']}/comments").json()
    assert tree_after_delete[0]["replies"][0]["deleted"] is True
    assert tree_after_delete[0]["replies"][0]["body"] == "Комментарий удалён"
    assert tree_after_delete[0]["replies"][0]["replies"][0]["body"] == "Ответ на ответ"
    assert client.get("/api/social/feed").json()["posts"][0]["commentCount"] == 2

    client.cookies.clear()
    assert client.get(f"/api/social/posts/{post['id']}/comments").status_code == 200
    assert client.post(
        f"/api/social/posts/{post['id']}/comments", json={"body": "Без входа"}
    ).status_code == 401


def test_friend_request_unlocks_friends_only_wall_and_feed(client: TestClient) -> None:
    unlock(client)
    client.post("/api/account/logout")
    registered = client.post(
        "/api/account/register",
        json={"username": "listener-two", "displayName": "Second Listener", "password": "another-secure-password"},
    )
    assert registered.status_code == 200
    assert client.post("/api/social/friends/testuser/request").json()["status"] == "outgoing"
    private_post = client.post(
        "/api/social/posts", json={"body": "Только для друзей", "visibility": "friends"}
    ).json()

    client.post("/api/account/logout")
    assert client.post(
        "/api/account/login", json={"username": "testuser", "password": "a-secure-test-password"}
    ).status_code == 200
    assert client.put(f"/api/social/posts/{private_post['id']}/like").status_code == 404
    friends = client.get("/api/social/friends").json()
    assert friends["incoming"][0]["username"] == "listener-two"
    assert client.post("/api/social/friends/listener-two/accept").json()["status"] == "friend"

    friend_feed = client.get("/api/social/feed", params={"mode": "friends"}).json()["posts"]
    assert private_post["id"] in {post["id"] for post in friend_feed}
    wall = client.get("/api/social/profiles/listener-two/posts").json()
    assert wall[0]["body"] == "Только для друзей"

    assert client.delete("/api/social/friends/listener-two").status_code == 200
    assert client.get("/api/social/friends/listener-two/status").json()["status"] == "none"


def test_password_change_requires_current_password(client: TestClient) -> None:
    unlock(client)
    missing = client.put("/api/account/password", json={"password": "new-secure-password"})
    assert missing.status_code == 400
    wrong = client.put(
        "/api/account/password",
        json={"currentPassword": "wrong-password", "password": "new-secure-password"},
    )
    assert wrong.status_code == 400
    changed = client.put(
        "/api/account/password",
        json={"currentPassword": "a-secure-test-password", "password": "new-secure-password"},
    )
    assert changed.status_code == 200
    assert client.post("/api/account/logout").status_code == 200
    assert client.post(
        "/api/account/login",
        json={"username": "testuser", "password": "a-secure-test-password"},
    ).status_code == 401
    assert client.post(
        "/api/account/login",
        json={"username": "testuser", "password": "new-secure-password"},
    ).status_code == 200


def test_profile_owner_can_update_display_name_and_avatar(client: TestClient) -> None:
    unlock(client)
    avatar = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )
    updated = client.put(
        "/api/account/profile",
        json={"displayName": "Updated Listener", "avatarDataUrl": avatar},
    )
    assert updated.status_code == 200
    assert updated.json()["displayName"] == "Updated Listener"
    assert updated.json()["avatarUrl"] == avatar

    bootstrap = client.get("/api/bootstrap").json()
    assert bootstrap["appUser"]["displayName"] == "Updated Listener"
    assert bootstrap["appUser"]["avatarUrl"] == avatar

    public_profile = client.get("/api/profiles/testuser").json()
    assert public_profile["displayName"] == "Updated Listener"
    assert public_profile["avatarUrl"] == avatar

    rejected = client.put(
        "/api/account/profile",
        json={"displayName": "Updated Listener", "avatarDataUrl": "data:image/svg+xml;base64,PHN2Zy8+"},
    )
    assert rejected.status_code == 400


def test_vk_taste_import_works_before_yandex_connection(client: TestClient) -> None:
    unlock(client)
    imported = client.post(
        "/api/import/vk",
        json={
            "sourceUrl": "https://vk.ru/audios123456",
            "tracks": [{"title": "Unmatched song", "artist": "Some artist"}],
        },
    )
    assert imported.status_code == 200
    assert imported.json()["matched"] == 0
    assert imported.json()["unmatched"][0]["title"] == "Unmatched song"


def test_vk_browser_import_collects_full_list_in_background(client: TestClient) -> None:
    connect(client)
    payload = {
        "sourceUrl": "https://vk.ru/audios145429079?section=all",
        "tracks": [
            {"title": "Test Signal", "artist": "Fixture Artist", "duration": "3:21"},
            {"title": "Unknown", "artist": "Unknown Artist", "duration": "2:10"},
        ],
    }
    received = client.post("/api/import/vk/jobs", json=payload)
    assert received.status_code == 200
    assert received.json()["total"] == 2
    assert received.json()["reused"] == 0

    job = None
    for _ in range(20):
        job = client.get("/api/import/vk/jobs/latest").json()
        if job and job["status"] in {"complete", "failed"}:
            break
        time.sleep(0.02)
    assert job is not None
    assert job["status"] == "complete"
    assert job["total"] == 2
    assert job["processed"] == 2
    assert job["matched"] == 1
    assert job["unmatched"] == 1

    extended = client.post(
        "/api/import/vk/jobs",
        json={
            **payload,
            "tracks": [{"title": "Third", "artist": "Another Artist"}] + payload["tracks"],
        },
    )
    assert extended.status_code == 200
    assert extended.json()["total"] == 3
    assert extended.json()["processed"] == 2
    assert extended.json()["matched"] == 1
    assert extended.json()["reused"] == 2


def test_interrupted_vk_import_is_resumable_after_restart(settings, store: CredentialStore) -> None:
    job = store.create_vk_import_job(
        LEGACY_USER_ID,
        "https://vk.ru/audios145429079",
        [{"title": "Signal", "artist": "Artist"}, {"title": "Second", "artist": "Artist"}],
    )
    tenant_token = store.set_current_user(LEGACY_USER_ID)
    try:
        store.update_vk_import_job(
            job["id"],
            status="failed",
            processed=1,
            error="Импорт прерван перезапуском сервиса. Запустите его ещё раз.",
        )
    finally:
        store.reset_current_user(tenant_token)

    reopened = CredentialStore(settings.database_path, settings.fernet_key)
    pending = reopened.incomplete_vk_import_jobs()
    assert pending[0]["id"] == job["id"]
    assert pending[0]["status"] == "queued"
    assert pending[0]["processed"] == 1
