from __future__ import annotations

import random

from .models import BootstrapPayload, PlaylistDTO, SearchPayload, SessionPayload, SessionPreferences, TrackDTO

DEMO_COVERS = {
    "violet": "/demo-covers/violet.jpg",
    "amber": "/demo-covers/amber.jpg",
    "blue": "/demo-covers/blue.jpg",
    "lime": "/demo-covers/lime.jpg",
    "coral": "/demo-covers/coral.jpg",
    "mono": "/demo-covers/mono.jpg",
}


DEMO_TRACKS = [
    TrackDTO(id="demo-01", title="Neon River", artists=["Polaris"], album="Night Geometry", duration_ms=221_000, cover_tone="violet", liked=True),
    TrackDTO(id="demo-02", title="Тёплый свет", artists=["Море внутри"], album="Горизонт", duration_ms=198_000, cover_tone="amber", liked=True),
    TrackDTO(id="demo-03", title="Low Gravity", artists=["Aster Club"], album="Signals", duration_ms=244_000, cover_tone="blue", liked=True),
    TrackDTO(id="demo-04", title="После дождя", artists=["Северный ветер"], album="Тихие улицы", duration_ms=209_000, cover_tone="lime", liked=False),
    TrackDTO(id="demo-05", title="Soft Focus", artists=["June Lines"], album="Frames", duration_ms=187_000, cover_tone="coral", liked=True),
    TrackDTO(id="demo-06", title="Орбита", artists=["Космос рядом"], album="Без сигнала", duration_ms=258_000, cover_tone="mono", liked=False),
    TrackDTO(id="demo-07", title="Morning Static", artists=["Mellow Circuit"], album="Open Windows", duration_ms=232_000, cover_tone="lime", liked=True),
    TrackDTO(id="demo-08", title="Линия воды", artists=["Волна"], album="Берег", duration_ms=216_000, cover_tone="blue", liked=False),
    TrackDTO(id="demo-09", title="Slow Bloom", artists=["Violet Hours"], album="Second Spring", duration_ms=203_000, cover_tone="violet", liked=True),
    TrackDTO(id="demo-10", title="Ночной автобус", artists=["Районы"], album="После полуночи", duration_ms=239_000, cover_tone="amber", liked=True),
    TrackDTO(id="demo-11", title="Paper Satellites", artists=["Northbound"], album="Small Worlds", duration_ms=194_000, cover_tone="coral", liked=False),
    TrackDTO(id="demo-12", title="Тишина громче", artists=["Эхо комнат"], album="Контуры", duration_ms=226_000, cover_tone="mono", liked=True),
]
DEMO_TRACKS = [
    track.model_copy(update={"cover_url": DEMO_COVERS[track.cover_tone]})
    for track in DEMO_TRACKS
]


DEMO_PLAYLISTS = [
    PlaylistDTO(id="demo-playlist-focus", title="Мягкий фокус", subtitle="Спокойный ритм без провалов", track_count=28, duration_minutes=101, cover_tone="violet", tracks=DEMO_TRACKS[:5]),
    PlaylistDTO(id="demo-playlist-new", title="За пределами привычного", subtitle="58% новой музыки", track_count=34, duration_minutes=126, cover_tone="lime", tracks=DEMO_TRACKS[3:9]),
    PlaylistDTO(id="demo-playlist-night", title="Город после полуночи", subtitle="Неон, воздух и редкие машины", track_count=22, duration_minutes=84, cover_tone="blue", tracks=DEMO_TRACKS[5:11]),
    PlaylistDTO(id="demo-playlist-sunday", title="Воскресенье без спешки", subtitle="Светлая и негромкая подборка", track_count=31, duration_minutes=116, cover_tone="amber", tracks=DEMO_TRACKS[1:7]),
    PlaylistDTO(id="demo-playlist-rediscover", title="Снова рядом", subtitle="Любимое, которое давно не звучало", track_count=19, duration_minutes=72, cover_tone="coral", tracks=DEMO_TRACKS[6:]),
]
DEMO_PLAYLISTS = [
    playlist.model_copy(update={"cover_url": DEMO_COVERS[playlist.cover_tone]})
    for playlist in DEMO_PLAYLISTS
]


def demo_bootstrap(*, access_locked: bool = False) -> BootstrapPayload:
    if access_locked:
        return BootstrapPayload(
            connected=False,
            demo=True,
            access_locked=True,
            quick_tracks=[],
            liked_tracks=[],
            liked_count=0,
            playlists=[],
            recommendations=[],
            rediscover=[],
        )
    return BootstrapPayload(
        connected=False,
        demo=True,
        access_locked=False,
        quick_tracks=DEMO_TRACKS[:6],
        liked_tracks=[track for track in DEMO_TRACKS if track.liked],
        liked_count=sum(1 for track in DEMO_TRACKS if track.liked),
        playlists=DEMO_PLAYLISTS[:3],
        recommendations=DEMO_PLAYLISTS,
        rediscover=DEMO_TRACKS[6:12],
    )


def demo_search(query: str) -> SearchPayload:
    normalized = query.casefold().strip()
    if not normalized:
        return SearchPayload()
    tracks = [
        track
        for track in DEMO_TRACKS
        if normalized in f"{track.title} {' '.join(track.artists)} {track.album or ''}".casefold()
    ]
    playlists = [
        playlist
        for playlist in DEMO_PLAYLISTS
        if normalized in f"{playlist.title} {playlist.subtitle or ''}".casefold()
    ]
    return SearchPayload(tracks=tracks, playlists=playlists)


def demo_session(preferences: SessionPreferences) -> SessionPayload:
    target_ms = preferences.duration * 60_000
    seed = preferences.discovery * 101 + preferences.cooldown_days * 17 + len(preferences.source)
    excluded_ids = set(preferences.exclude_track_ids)
    pool = [track for track in DEMO_TRACKS if track.id not in excluded_ids]
    random.Random(seed).shuffle(pool)
    tracks: list[TrackDTO] = []
    duration = 0
    for track in pool:
        if duration >= target_ms:
            break
        tracks.append(track)
        duration += track.duration_ms
    return SessionPayload(tracks=tracks)
