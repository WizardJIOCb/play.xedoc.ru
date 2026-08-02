from __future__ import annotations

import base64
from dataclasses import replace

from fastapi.testclient import TestClient

from app.store import CredentialStore

from .conftest import FakeGateway, TEST_CREDENTIAL, connect, unlock


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


def test_access_gate_and_demo_bootstrap(client: TestClient) -> None:
    locked = client.get("/api/bootstrap")
    assert locked.status_code == 200
    assert locked.json()["accessLocked"] is True
    assert locked.json()["quickTracks"] == []
    assert "access_locked" not in locked.json()

    denied = client.post("/api/account/login", json={"username": "nobody", "password": "wrong-password"})
    assert denied.status_code == 401

    unlock(client)
    demo = client.get("/api/bootstrap")
    assert demo.status_code == 200
    assert demo.json()["accessLocked"] is False
    assert demo.json()["authenticated"] is True
    assert demo.json()["appUser"]["username"] == "testuser"
    assert demo.json()["connected"] is False
    assert demo.json()["demo"] is True
    assert demo.json()["quickTracks"][0]["id"].startswith("demo-")
    assert demo.json()["quickTracks"][0]["coverUrl"].startswith("/demo-covers/")
    assert demo.json()["playlists"][0]["coverUrl"].startswith("/demo-covers/")


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

    liked = client.put("/api/tracks/101/like")
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

    image = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"x" * 40).decode()
    covered = client.put(f"/api/local-playlists/{playlist_id}/cover", json={"dataUrl": image})
    assert covered.status_code == 200
    assert covered.json()["coverUrl"] == image

    listened = client.post("/api/listening-events", json={
        "track": {"id": "101", "title": "Test Signal", "artists": ["Fixture Artist"], "durationMs": 201_000},
        "listenedMs": 20_000,
    })
    assert listened.json() == {"ok": True}
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

    discovery = client.get("/api/discovery-recommendations")
    assert discovery.status_code == 200
    assert discovery.json()["tracks"][0]["id"] == "202"
    assert discovery.json()["seedCount"] == 1
    assert fake_gateway.discovery_contexts[-1][0] == ["101"]
    assert "101" in fake_gateway.discovery_contexts[-1][1]

    shared = client.post("/api/shares/playlists", json={"playlistId": playlist_id})
    assert shared.status_code == 200
    removed = client.delete(f"/api/local-playlists/{playlist_id}/tracks/101")
    assert removed.json()["trackCount"] == 0
    assert client.delete(f"/api/local-playlists/{playlist_id}").json() == {"ok": True}


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


def test_demo_search_session_and_playlist(client: TestClient) -> None:
    unlock(client)
    search = client.get("/api/search", params={"q": "свет"})
    assert search.status_code == 200
    assert any(track["title"] == "Тёплый свет" for track in search.json()["tracks"])

    session = client.post(
        "/api/sessions/build",
        json={
            "duration": 25,
            "discovery": 50,
            "cooldownDays": 7,
            "source": "liked",
            "excludeTrackIds": ["demo-01", "demo-02"],
        },
    )
    assert session.status_code == 200
    assert session.json()["tracks"]
    assert not {"demo-01", "demo-02"} & {track["id"] for track in session.json()["tracks"]}

    playlist_id = client.get("/api/bootstrap").json()["playlists"][0]["id"]
    playlist = client.get(f"/api/playlists/{playlist_id}")
    assert playlist.status_code == 200
    assert playlist.json()["tracks"]


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
    assert client.get("/api/search", params={"q": "test"}).status_code == 401
    assert client.put("/api/tracks/101/like").status_code == 401


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


def test_vk_taste_import_works_before_yandex_connection(client: TestClient) -> None:
    unlock(client)
    imported = client.post(
        "/api/import/vk",
        json={
            "sourceUrl": "https://vk.ru/audios-example",
            "tracks": [{"title": "Unmatched song", "artist": "Some artist"}],
        },
    )
    assert imported.status_code == 200
    assert imported.json()["matched"] == 0
    assert imported.json()["unmatched"][0]["title"] == "Unmatched song"
