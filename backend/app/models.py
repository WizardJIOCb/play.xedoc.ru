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


class UserProfileDTO(APIModel):
    name: str
    avatar_url: str | None = None


class BootstrapPayload(APIModel):
    connected: bool
    demo: bool
    access_locked: bool
    user: UserProfileDTO | None = None
    quick_tracks: list[TrackDTO] = Field(default_factory=list)
    liked_tracks: list[TrackDTO] = Field(default_factory=list)
    liked_count: int = 0
    playlists: list[PlaylistDTO] = Field(default_factory=list)
    recommendations: list[PlaylistDTO] = Field(default_factory=list)
    rediscover: list[TrackDTO] = Field(default_factory=list)


class SearchPayload(APIModel):
    tracks: list[TrackDTO] = Field(default_factory=list)
    playlists: list[PlaylistDTO] = Field(default_factory=list)


class AccessUnlockRequest(APIModel):
    key: str = Field(min_length=1, max_length=512)


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
