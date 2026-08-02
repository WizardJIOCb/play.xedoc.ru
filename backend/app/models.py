from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class APIModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


CoverTone = Literal["lime", "violet", "coral", "blue", "amber", "mono"]


class TrackDTO(APIModel):
    id: str
    title: str
    artists: list[str]
    album: str | None = None
    duration_ms: int = 0
    cover_url: str | None = None
    cover_tone: CoverTone | None = None
    liked: bool | None = None
    explicit: bool | None = None
    stream_url: str | None = None
    play_count: int | None = None
    total_listened_ms: int | None = None
    last_played_at: int | None = None


class PlaylistDTO(APIModel):
    id: str
    title: str
    subtitle: str | None = None
    track_count: int = 0
    duration_minutes: int | None = None
    cover_url: str | None = None
    cover_tone: CoverTone | None = None
    accent: str | None = None
    tracks: list[TrackDTO] | None = None
    description: str | None = None
    local: bool = False


class RecommendationCollectionDTO(APIModel):
    id: str
    title: str
    subtitle: str
    period_days: Literal[1, 3, 7, 30]
    signal_count: int = 0
    fallback: bool = False
    tracks: list[TrackDTO] = Field(default_factory=list)


class UserProfileDTO(APIModel):
    name: str
    avatar_url: str | None = None


class AppUserDTO(APIModel):
    id: str
    username: str
    display_name: str
    needs_password: bool = False


class BootstrapPayload(APIModel):
    connected: bool
    demo: bool
    access_locked: bool
    authenticated: bool = False
    app_user: AppUserDTO | None = None
    user: UserProfileDTO | None = None
    quick_tracks: list[TrackDTO] = Field(default_factory=list)
    liked_tracks: list[TrackDTO] = Field(default_factory=list)
    liked_count: int = 0
    playlists: list[PlaylistDTO] = Field(default_factory=list)
    recommendations: list[PlaylistDTO] = Field(default_factory=list)
    rediscover: list[TrackDTO] = Field(default_factory=list)
    local_playlists: list[PlaylistDTO] = Field(default_factory=list)
    xedoc_recommendations: list[TrackDTO] = Field(default_factory=list)
    recommendation_insight: str | None = None
    xedoc_collections: list[RecommendationCollectionDTO] = Field(default_factory=list)


class SearchPayload(APIModel):
    tracks: list[TrackDTO] = Field(default_factory=list)
    playlists: list[PlaylistDTO] = Field(default_factory=list)


class LikedTracksPayload(APIModel):
    tracks: list[TrackDTO] = Field(default_factory=list)
    total: int = 0


class DiscoveryRecommendationsPayload(APIModel):
    tracks: list[TrackDTO] = Field(default_factory=list)
    seed_count: int = 0
    known_track_count: int = 0
    insight: str


class ListeningTopDTO(APIModel):
    id: str
    title: str
    period_days: Literal[1, 3, 7, 30] | None = None
    total_plays: int = 0
    tracks: list[TrackDTO] = Field(default_factory=list)


class ListeningStatsPayload(APIModel):
    total_plays: int = 0
    unique_tracks: int = 0
    total_listened_ms: int = 0
    top: list[ListeningTopDTO] = Field(default_factory=list)


class AccessUnlockRequest(APIModel):
    key: str = Field(min_length=1, max_length=512)


class AccountRegisterRequest(APIModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$")
    display_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=10, max_length=128)


class AccountLoginRequest(APIModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=128)


class AccountPasswordRequest(APIModel):
    password: str = Field(min_length=10, max_length=128)


class DeviceAuthStartDTO(APIModel):
    device_id: str
    user_code: str
    verification_url: str
    expires_in: int
    interval: int


class DeviceAuthPollRequest(APIModel):
    device_id: str = Field(min_length=16, max_length=256)


class DeviceAuthPollDTO(APIModel):
    connected: bool


class SessionPreferences(APIModel):
    duration: Literal[25, 50, 90]
    discovery: int = Field(ge=0, le=100)
    cooldown_days: Literal[7, 30, 90]
    source: Literal["all", "liked", "playlists"]
    exclude_track_ids: list[str] = Field(default_factory=list, max_length=500)


class SessionPayload(APIModel):
    tracks: list[TrackDTO]


class ActionResponse(APIModel):
    ok: bool = True


class LocalPlaylistCreateRequest(APIModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)


class LocalPlaylistUpdateRequest(APIModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=4000)


class PlaylistCoverRequest(APIModel):
    data_url: str = Field(min_length=32, max_length=2_000_000)


class PlaylistTrackRequest(APIModel):
    track: TrackDTO


class ListeningEventRequest(APIModel):
    track: TrackDTO
    listened_ms: int = Field(ge=10_000, le=86_400_000)
    source: Literal["player", "vk_seed"] = "player"


class ExternalTrackDTO(APIModel):
    title: str = Field(min_length=1, max_length=300)
    artist: str = Field(min_length=1, max_length=300)
    duration: str | None = Field(default=None, max_length=16)


class VKImportRequest(APIModel):
    tracks: list[ExternalTrackDTO] = Field(min_length=1, max_length=10000)
    source_url: str = Field(default="https://vk.ru/audios145429079", max_length=500)


class VKImportResult(APIModel):
    playlist: PlaylistDTO
    matched: int
    unmatched: list[ExternalTrackDTO] = Field(default_factory=list)


class VKImportJobDTO(APIModel):
    id: str
    status: Literal["queued", "running", "complete", "failed"]
    source_url: str
    total: int
    processed: int
    matched: int
    unmatched: int
    playlist_id: str | None = None
    error: str | None = None
    created_at: int
    updated_at: int


class TrackShareRequest(APIModel):
    track: TrackDTO


class PlaylistShareRequest(APIModel):
    playlist_id: str = Field(min_length=1, max_length=256)


class ShareLinkDTO(APIModel):
    token: str
    path: str


class PublicShareDTO(APIModel):
    token: str
    kind: Literal["track", "playlist"]
    shared_by: str
    created_at: int
    track: TrackDTO | None = None
    playlist: PlaylistDTO | None = None
