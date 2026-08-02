from __future__ import annotations

import asyncio
import random
import secrets
import time
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import quote, urlparse

from .config import Settings
from .models import (
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
from .store import Credential

try:
    from yandex_music import ClientAsync
    from yandex_music.exceptions import (
        DeviceAuthError,
        NotFoundError,
        UnauthorizedError,
        YandexMusicError,
    )
    from yandex_music.utils.request_async import Request
except ModuleNotFoundError:  # pragma: no cover - gives a useful runtime error without breaking mocked tests
    ClientAsync = None  # type: ignore[assignment,misc]
    Request = None  # type: ignore[assignment,misc]

    class YandexMusicError(Exception):
        pass

    class DeviceAuthError(YandexMusicError):
        pass

    class NotFoundError(YandexMusicError):
        pass

    class UnauthorizedError(YandexMusicError):
        pass


class GatewayError(RuntimeError):
    """A sanitized upstream error that is safe to expose through the API."""


class GatewayUnavailable(GatewayError):
    pass


class GatewayUnauthorized(GatewayError):
    pass


class GatewayNotFound(GatewayError):
    pass


class DeviceFlowRejected(GatewayError):
    pass


@dataclass(slots=True)
class DeviceAuthorization:
    upstream_device_id: str
    device_code: str
    user_code: str
    verification_url: str
    expires_in: int
    interval: int


class MusicGateway(Protocol):
    async def start_device_auth(self) -> DeviceAuthorization: ...

    async def poll_device_auth(self, authorization: DeviceAuthorization) -> Credential | None: ...

    async def bootstrap(self, credential: Credential) -> BootstrapPayload: ...

    async def search(self, credential: Credential, query: str) -> SearchPayload: ...

    async def liked_tracks(self, credential: Credential) -> LikedTracksPayload: ...

    async def discovery_recommendations(
        self,
        credential: Credential,
        seed_track_ids: list[str],
        exclude_track_ids: set[str],
    ) -> DiscoveryRecommendationsPayload: ...

    async def set_like(self, credential: Credential, track_id: str, liked: bool) -> None: ...

    async def stream_url(self, credential: Credential, track_id: str) -> str: ...

    async def build_session(
        self, credential: Credential, preferences: SessionPreferences
    ) -> SessionPayload: ...

    async def playlist(self, credential: Credential, playlist_id: str) -> PlaylistDTO: ...


class YandexMusicGateway:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._liked_cache: dict[str, tuple[float, set[str | None]]] = {}

    def _client(self, token: str | None = None) -> Any:
        if ClientAsync is None or Request is None:
            raise GatewayUnavailable("Yandex Music dependency is not installed")
        request = Request(timeout=self.settings.request_timeout_seconds)
        return ClientAsync(token=token, request=request)

    async def _authorized_client(self, credential: Credential) -> Any:
        if credential.expires_soon:
            # yandex-music 3.0.0 exposes Device Flow but no refresh-token method.
            raise GatewayUnauthorized("Yandex Music session expired; connect the account again")
        client = self._client(credential.access_token)
        client.account_uid = _number_or_text(credential.user_uid)
        return client

    async def start_device_auth(self) -> DeviceAuthorization:
        upstream_device_id = f"xedoc-{secrets.token_hex(12)}"
        client_id, _ = self.settings.yandex_credentials
        try:
            result = await self._client().request_device_code(
                device_id=upstream_device_id,
                device_name="XEDOC Play",
                client_id=client_id,
            )
        except DeviceAuthError as exc:
            raise DeviceFlowRejected("Yandex rejected the device authorization request") from exc
        except YandexMusicError as exc:
            raise GatewayUnavailable("Yandex Music authorization is temporarily unavailable") from exc

        return DeviceAuthorization(
            upstream_device_id=upstream_device_id,
            device_code=result.device_code,
            user_code=result.user_code,
            verification_url=result.verification_url,
            expires_in=max(1, int(result.expires_in)),
            interval=max(3, int(result.interval)),
        )

    async def poll_device_auth(self, authorization: DeviceAuthorization) -> Credential | None:
        client_id, client_secret = self.settings.yandex_credentials
        try:
            token = await self._client().poll_device_token(
                authorization.device_code,
                client_id=client_id,
                client_secret=client_secret,
            )
            if token is None:
                return None

            client = self._client(token.access_token)
            await client.init()
            account = getattr(getattr(client, "me", None), "account", None)
            if account is None or getattr(account, "uid", None) is None:
                raise DeviceFlowRejected("Yandex did not return an account profile")
        except UnauthorizedError as exc:
            raise DeviceFlowRejected("Yandex Music account authorization failed") from exc
        except DeviceAuthError as exc:
            raise DeviceFlowRejected("Device code expired or authorization was denied") from exc
        except YandexMusicError as exc:
            raise GatewayUnavailable("Yandex Music authorization is temporarily unavailable") from exc

        uid = str(account.uid)
        allowed_uid = self.settings.yandex_allowed_uid
        if allowed_uid and uid != str(allowed_uid):
            raise DeviceFlowRejected("This Yandex account is not allowed in the private beta")

        name = (
            getattr(account, "display_name", None)
            or getattr(account, "full_name", None)
            or getattr(account, "login", None)
            or "Моя музыка"
        )
        expires_in = int(token.expires_in) if token.expires_in else None
        return Credential(
            access_token=token.access_token,
            refresh_token=token.refresh_token,
            expires_at=int(time.time()) + expires_in if expires_in else None,
            device_id=authorization.upstream_device_id,
            user_uid=uid,
            user_name=str(name),
            avatar_url=None,
        )

    async def bootstrap(self, credential: Credential) -> BootstrapPayload:
        client = await self._authorized_client(credential)
        playlist_result, likes_result, feed_result = await asyncio.gather(
            client.users_playlists_list(user_id=_number_or_text(credential.user_uid)),
            client.users_likes_tracks(user_id=_number_or_text(credential.user_uid)),
            client.feed(),
            return_exceptions=True,
        )

        upstream_succeeded = any(
            not isinstance(item, Exception) for item in (playlist_result, likes_result, feed_result)
        )
        _raise_if_authorization_failed(playlist_result, likes_result, feed_result)
        if not upstream_succeeded:
            raise GatewayUnavailable("Yandex Music is temporarily unavailable")

        playlists = [] if isinstance(playlist_result, Exception) else list(playlist_result or [])
        liked_shorts = []
        if not isinstance(likes_result, Exception) and likes_result is not None:
            liked_shorts = list(getattr(likes_result, "tracks", None) or [])
        liked_ids: set[str | None] = set()
        for item in liked_shorts:
            liked_ids.add(_short_track_id(item))
            raw_id = getattr(item, "id", None)
            if raw_id is not None:
                liked_ids.add(str(raw_id))
        liked_ids.discard(None)
        self._liked_cache[str(credential.user_uid)] = (time.monotonic() + 300, set(liked_ids))
        liked_tracks = await self._hydrate_shorts(client, liked_shorts[:80])

        recommendation_models: list[Any] = []
        if not isinstance(feed_result, Exception) and feed_result is not None:
            recommendation_models = _extract_playlists(feed_result, limit=16)

        quick_tracks = [map_track(track, liked_ids=liked_ids).model_copy(update={"liked": True}) for track in liked_tracks[:6]]
        rediscover_source = liked_tracks[12:24] or liked_tracks[6:18] or list(reversed(liked_tracks[:12]))
        rediscover = [map_track(track, liked_ids=liked_ids).model_copy(update={"liked": True}) for track in rediscover_source[:12]]
        own_playlists = [map_playlist(item, include_tracks=False) for item in playlists[:100]]
        recommendations = [
            map_playlist(item, include_tracks=False)
            for item in _dedupe_playlists(recommendation_models)
            if _playlist_identity(item) is not None
        ][:16]

        return BootstrapPayload(
            connected=True,
            demo=not upstream_succeeded,
            access_locked=False,
            user=UserProfileDTO(name=credential.user_name, avatar_url=credential.avatar_url),
            quick_tracks=quick_tracks,
            liked_tracks=[map_track(track, liked_ids=liked_ids).model_copy(update={"liked": True}) for track in liked_tracks],
            liked_count=len(liked_shorts),
            playlists=own_playlists,
            recommendations=recommendations,
            rediscover=rediscover,
        )

    async def search(self, credential: Credential, query: str) -> SearchPayload:
        client = await self._authorized_client(credential)
        try:
            result = await client.search(query, type_="all", page=0, playlist_in_best=True)
        except UnauthorizedError as exc:
            raise GatewayUnauthorized("Yandex Music session expired") from exc
        except YandexMusicError as exc:
            raise GatewayUnavailable("Yandex Music search is temporarily unavailable") from exc

        if result is None:
            return SearchPayload()
        tracks = list(getattr(getattr(result, "tracks", None), "results", None) or [])[:50]
        playlists = [
            item
            for item in list(getattr(getattr(result, "playlists", None), "results", None) or [])
            if _playlist_identity(item) is not None
        ][:30]
        liked_ids = await self._liked_ids(client, credential.user_uid)
        return SearchPayload(
            tracks=[map_track(track, liked_ids=liked_ids) for track in tracks],
            playlists=[map_playlist(item, include_tracks=False) for item in playlists],
        )

    async def liked_tracks(self, credential: Credential) -> LikedTracksPayload:
        client = await self._authorized_client(credential)
        try:
            result = await client.users_likes_tracks(user_id=_number_or_text(credential.user_uid))
        except UnauthorizedError as exc:
            raise GatewayUnauthorized("Yandex Music session expired") from exc
        except YandexMusicError as exc:
            raise GatewayUnavailable("Yandex Music likes are temporarily unavailable") from exc
        shorts = list(getattr(result, "tracks", None) or [])
        hydrated = await self._hydrate_shorts(client, shorts[:2000])
        liked_ids = {_short_track_id(item) for item in shorts}
        liked_ids.discard(None)
        return LikedTracksPayload(
            tracks=[map_track(track, liked_ids=liked_ids).model_copy(update={"liked": True}) for track in hydrated],
            total=len(shorts),
        )

    async def discovery_recommendations(
        self,
        credential: Credential,
        seed_track_ids: list[str],
        exclude_track_ids: set[str],
    ) -> DiscoveryRecommendationsPayload:
        client = await self._authorized_client(credential)
        try:
            likes_result, playlists_result, history_result = await asyncio.gather(
                client.users_likes_tracks(user_id=_number_or_text(credential.user_uid)),
                client.users_playlists_list(user_id=_number_or_text(credential.user_uid)),
                client.music_history(full_models_count=0),
                return_exceptions=True,
            )
            _raise_if_authorization_failed(likes_result, playlists_result, history_result)
            if isinstance(likes_result, Exception) or isinstance(playlists_result, Exception):
                raise GatewayUnavailable("Could not read the existing music collection")
            liked_shorts = list(getattr(likes_result, "tracks", None) or [])
            history_ids = [] if isinstance(history_result, Exception) else _music_history_track_ids(history_result)
            playlist_summaries = list(playlists_result or [])
            kinds = [
                getattr(item, "kind")
                for item in playlist_summaries
                if getattr(item, "kind", None) is not None
            ]
            full_playlists: list[Any] = []
            if kinds:
                playlist_results = await asyncio.gather(
                    *[
                        client.users_playlists(
                            kind=kinds[index:index + 50],
                            user_id=_number_or_text(credential.user_uid),
                        )
                        for index in range(0, len(kinds), 50)
                    ]
                )
                for playlist_result in playlist_results:
                    if isinstance(playlist_result, list):
                        full_playlists.extend(playlist_result)
                    elif playlist_result is not None:
                        full_playlists.append(playlist_result)

            known_ids = set(exclude_track_ids)
            known_ids.update(
                identifier
                for item in liked_shorts
                if (identifier := _short_track_id(item)) is not None
            )
            known_ids.update(history_ids)
            for playlist in full_playlists:
                known_ids.update(
                    identifier
                    for item in list(getattr(playlist, "tracks", None) or [])
                    if (identifier := _short_track_id(item)) is not None
                )

            seeds = _dedupe_identifiers([*seed_track_ids, *history_ids])
            if not seeds:
                seeds = _dedupe_identifiers(
                    [identifier for item in liked_shorts if (identifier := _short_track_id(item))]
                )
            seeds = seeds[:6]
            if not seeds:
                return DiscoveryRecommendationsPayload(
                    tracks=[],
                    seed_count=0,
                    known_track_count=len(_canonical_identifiers(known_ids)),
                    insight="Послушайте несколько треков — затем мы найдём новое по сходству.",
                )

            similar_results = await asyncio.gather(
                *[client.tracks_similar(seed) for seed in seeds],
                return_exceptions=True,
            )
            try:
                wave_result = await client.rotor_station_tracks("user:onyourwave")
            except YandexMusicError:
                wave_result = None
        except UnauthorizedError as exc:
            raise GatewayUnauthorized("Yandex Music session expired") from exc
        except YandexMusicError as exc:
            raise GatewayUnavailable("Could not build discovery recommendations") from exc

        known_aliases = _identifier_aliases_for(known_ids)
        scores: dict[str, float] = {}
        candidates: dict[str, Any] = {}
        for seed_index, result in enumerate(similar_results):
            if isinstance(result, Exception) or result is None:
                continue
            for position, track in enumerate(list(getattr(result, "similar_tracks", None) or [])[:30]):
                track_id = _track_id(track)
                if _identifier_aliases(track_id) & known_aliases:
                    continue
                candidates[track_id] = track
                scores[track_id] = scores.get(track_id, 0) + max(1.0, 30 - position) * max(.55, 1 - seed_index * .09)

        for position, sequence in enumerate(list(getattr(wave_result, "sequence", None) or [])[:60]):
            track = getattr(sequence, "track", None)
            if track is None:
                continue
            track_id = _track_id(track)
            if _identifier_aliases(track_id) & known_aliases:
                continue
            candidates.setdefault(track_id, track)
            scores[track_id] = scores.get(track_id, 0) + max(.25, 5 - position * .08)

        ranked = sorted(candidates.values(), key=lambda item: scores.get(_track_id(item), 0), reverse=True)
        selected: list[Any] = []
        artist_counts: dict[str, int] = {}
        for track in ranked:
            if getattr(track, "available", True) is False:
                continue
            artist = _primary_artist(track)
            if artist and artist_counts.get(artist, 0) >= 2:
                continue
            selected.append(track)
            if artist:
                artist_counts[artist] = artist_counts.get(artist, 0) + 1
            if len(selected) >= 24:
                break

        liked_aliases = _identifier_aliases_for(
            identifier for item in liked_shorts if (identifier := _short_track_id(item))
        )
        tracks = [map_track(track, liked_ids=liked_aliases) for track in selected]
        return DiscoveryRecommendationsPayload(
            tracks=tracks,
            seed_count=len(seeds),
            known_track_count=len(_canonical_identifiers(known_ids)),
            insight=(
                f"Сравнили с {len(seeds)} недавними треками и исключили всё, что уже есть в вашей музыке."
                if tracks
                else "Похожая музыка найдена, но все кандидаты уже встречались в вашей коллекции."
            ),
        )

    async def set_like(self, credential: Credential, track_id: str, liked: bool) -> None:
        client = await self._authorized_client(credential)
        try:
            if liked:
                result = await client.users_likes_tracks_add(track_id)
            else:
                result = await client.users_likes_tracks_remove(track_id)
        except UnauthorizedError as exc:
            raise GatewayUnauthorized("Yandex Music session expired") from exc
        except NotFoundError as exc:
            raise GatewayNotFound("Track was not found") from exc
        except YandexMusicError as exc:
            raise GatewayUnavailable("Could not update the Yandex Music collection") from exc
        if result is False:
            raise GatewayUnavailable("Yandex Music did not accept the collection update")
        cached = self._liked_cache.get(str(credential.user_uid))
        if cached is not None:
            values = cached[1]
            identifiers = {track_id, track_id.split(":", 1)[0]}
            if liked:
                values.update(identifiers)
            else:
                values.difference_update(identifiers)
            self._liked_cache[str(credential.user_uid)] = (time.monotonic() + 300, values)

    async def stream_url(self, credential: Credential, track_id: str) -> str:
        client = await self._authorized_client(credential)
        try:
            variants = await client.tracks_download_info(track_id, get_direct_links=False)
            available = [item for item in variants if not bool(getattr(item, "preview", False))]
            if not available:
                available = list(variants)
            if not available:
                raise GatewayNotFound("No playable version of this track is available")
            selected = max(
                available,
                key=lambda item: (
                    str(getattr(item, "codec", "")).lower() == "mp3",
                    int(getattr(item, "bitrate_in_kbps", 0) or 0),
                ),
            )
            direct_url = await selected.get_direct_link_async()
        except UnauthorizedError as exc:
            raise GatewayUnauthorized("Yandex Music session expired") from exc
        except NotFoundError as exc:
            raise GatewayNotFound("Track was not found") from exc
        except GatewayError:
            raise
        except YandexMusicError as exc:
            raise GatewayUnavailable("Yandex Music stream is temporarily unavailable") from exc

        parsed = urlparse(direct_url)
        if parsed.scheme != "https" or not parsed.hostname:
            raise GatewayUnavailable("Yandex Music returned an invalid stream URL")
        return direct_url

    async def playlist(self, credential: Credential, playlist_id: str) -> PlaylistDTO:
        owner, kind = _parse_playlist_id(playlist_id, credential.user_uid)
        client = await self._authorized_client(credential)
        try:
            result = await client.users_playlists(kind=kind, user_id=_number_or_text(owner))
            if isinstance(result, list):
                result = result[0] if result else None
            if result is None:
                raise GatewayNotFound("Playlist was not found")

            shorts = list(getattr(result, "tracks", None) or [])
            tracks = await self._hydrate_shorts(client, shorts)
            dto = map_playlist(result, include_tracks=False)
            liked_ids = await self._liked_ids(client, credential.user_uid)
            dto.tracks = [map_track(track, liked_ids=liked_ids) for track in tracks]
            dto.track_count = int(getattr(result, "track_count", None) or len(dto.tracks))
            return dto
        except UnauthorizedError as exc:
            raise GatewayUnauthorized("Yandex Music session expired") from exc
        except NotFoundError as exc:
            raise GatewayNotFound("Playlist was not found") from exc
        except GatewayError:
            raise
        except YandexMusicError as exc:
            raise GatewayUnavailable("Yandex Music playlist is temporarily unavailable") from exc

    async def build_session(
        self, credential: Credential, preferences: SessionPreferences
    ) -> SessionPayload:
        client = await self._authorized_client(credential)
        try:
            liked_task = None
            if preferences.source != "playlists":
                liked_task = asyncio.create_task(
                    client.users_likes_tracks(user_id=_number_or_text(credential.user_uid))
                )
            playlist_task = None
            wave_task = None
            if preferences.source in {"all", "playlists"}:
                playlist_task = asyncio.create_task(
                    client.users_playlists_list(user_id=_number_or_text(credential.user_uid))
                )
            if preferences.source == "all":
                wave_task = asyncio.create_task(client.rotor_station_tracks("user:onyourwave"))

            liked_tracks: list[Any] = []
            if liked_task is not None:
                try:
                    likes_result = await liked_task
                    liked_shorts = list(getattr(likes_result, "tracks", None) or []) if likes_result else []
                    liked_tracks = await self._hydrate_shorts(client, liked_shorts[:160])
                except UnauthorizedError:
                    raise
                except YandexMusicError:
                    if preferences.source == "liked":
                        raise

            playlist_tracks: list[Any] = []
            if playlist_task is not None:
                playlist_summaries = list((await playlist_task) or [])[:8]
                full_results = await asyncio.gather(
                    *[
                        client.users_playlists(
                            kind=getattr(item, "kind"),
                            user_id=getattr(item, "uid", None) or _number_or_text(credential.user_uid),
                        )
                        for item in playlist_summaries
                        if getattr(item, "kind", None) is not None
                    ],
                    return_exceptions=True,
                )
                playlist_shorts: list[Any] = []
                for playlist in full_results:
                    if isinstance(playlist, Exception) or playlist is None:
                        continue
                    if isinstance(playlist, list):
                        playlist = playlist[0] if playlist else None
                    if playlist is not None:
                        shorts = list(getattr(playlist, "tracks", None) or [])[:80]
                        playlist_shorts.extend(shorts)
                playlist_tracks = await self._hydrate_shorts(client, playlist_shorts)

            wave_tracks: list[Any] = []
            if wave_task is not None:
                wave_result = await wave_task
                for sequence in list(getattr(wave_result, "sequence", None) or []):
                    track = getattr(sequence, "track", None)
                    if track is not None:
                        wave_tracks.append(track)
        except UnauthorizedError as exc:
            raise GatewayUnauthorized("Yandex Music session expired") from exc
        except YandexMusicError as exc:
            raise GatewayUnavailable("Could not build a music session") from exc

        if preferences.source == "liked":
            familiar = liked_tracks
            discovery: list[Any] = []
        elif preferences.source == "playlists":
            familiar = playlist_tracks
            discovery = []
        else:
            familiar = _dedupe_tracks(liked_tracks + playlist_tracks)
            known_ids = {_track_id(track) for track in familiar}
            discovery = [track for track in _dedupe_tracks(wave_tracks) if _track_id(track) not in known_ids]

        excluded_ids = set(preferences.exclude_track_ids)
        familiar = [track for track in familiar if _track_id(track) not in excluded_ids]
        discovery = [track for track in discovery if _track_id(track) not in excluded_ids]

        selected = _balanced_tracks(
            familiar=familiar,
            discovery=discovery,
            target_ms=preferences.duration * 60_000,
            discovery_percent=preferences.discovery if preferences.source == "all" else 0,
            cooldown_days=preferences.cooldown_days,
        )
        liked_ids = {_track_id(track) for track in liked_tracks}
        return SessionPayload(tracks=[map_track(track, liked_ids=liked_ids) for track in selected])

    async def _hydrate_shorts(self, client: Any, shorts: list[Any]) -> list[Any]:
        if not shorts:
            return []
        hydrated: list[Any] = []
        missing_ids: list[str] = []
        for item in shorts:
            track = getattr(item, "track", None)
            if track is not None:
                hydrated.append(track)
                continue
            track_id = _short_track_id(item)
            if track_id is not None:
                missing_ids.append(track_id)
        if missing_ids:
            batches = [missing_ids[index : index + 50] for index in range(0, len(missing_ids), 50)]
            results = await asyncio.gather(
                *[client.tracks(batch, with_positions=False) for batch in batches],
                return_exceptions=True,
            )
            for result in results:
                if not isinstance(result, Exception):
                    hydrated.extend(result or [])
        return _dedupe_tracks(hydrated)

    async def _liked_ids(self, client: Any, user_uid: str) -> set[str | None]:
        key = str(user_uid)
        cached = self._liked_cache.get(key)
        if cached is not None and cached[0] > time.monotonic():
            return set(cached[1])
        try:
            result = await client.users_likes_tracks(user_id=_number_or_text(user_uid))
        except UnauthorizedError as exc:
            raise GatewayUnauthorized("Yandex Music session expired") from exc
        except YandexMusicError:
            return set()
        identifiers: set[str | None] = set()
        for item in list(getattr(result, "tracks", None) or []):
            identifiers.add(_short_track_id(item))
            raw_id = getattr(item, "id", None)
            if raw_id is not None:
                identifiers.add(str(raw_id))
        identifiers.discard(None)
        self._liked_cache[key] = (time.monotonic() + 300, set(identifiers))
        return identifiers


def map_track(track: Any, *, liked_ids: set[str | None] | None = None) -> TrackDTO:
    track = getattr(track, "track", None) or track
    track_id = _track_id(track)
    artists = [
        str(getattr(artist, "name"))
        for artist in list(getattr(track, "artists", None) or [])
        if getattr(artist, "name", None)
    ]
    albums = list(getattr(track, "albums", None) or [])
    album = getattr(albums[0], "title", None) if albums else None
    explicit_value = getattr(track, "explicit", None)
    if explicit_value is None:
        explicit_value = getattr(track, "content_warning", None) == "explicit"
    liked = str(track_id) in liked_ids if liked_ids is not None else None
    return TrackDTO(
        id=str(track_id),
        title=str(getattr(track, "title", None) or "Без названия"),
        artists=artists or ["Неизвестный исполнитель"],
        album=str(album) if album else None,
        duration_ms=max(0, int(getattr(track, "duration_ms", None) or 0)),
        cover_url=_image_url(getattr(track, "cover_uri", None) or getattr(track, "og_image", None)),
        cover_tone=_tone_for(str(track_id)),
        liked=liked,
        explicit=bool(explicit_value),
        stream_url=f"/api/tracks/{quote(str(track_id), safe='')}/stream",
    )


def map_playlist(playlist: Any, *, include_tracks: bool) -> PlaylistDTO:
    owner = getattr(playlist, "uid", None) or getattr(getattr(playlist, "owner", None), "uid", None)
    kind = getattr(playlist, "kind", None)
    fallback_id = getattr(playlist, "playlist_uuid", None) or getattr(playlist, "url_part", None)
    if owner is not None and kind is not None:
        playlist_id = f"{owner}:{kind}"
    elif kind is not None:
        playlist_id = str(kind)
    else:
        playlist_id = str(fallback_id or secrets.token_hex(6))

    cover = getattr(playlist, "cover", None) or getattr(playlist, "cover_without_text", None)
    cover_uri = (
        getattr(cover, "uri", None)
        or next(iter(getattr(cover, "items_uri", None) or []), None)
        or getattr(playlist, "og_image", None)
        or getattr(playlist, "image", None)
        or getattr(playlist, "background_image_url", None)
    )
    tracks_raw = list(getattr(playlist, "tracks", None) or [])
    mapped_tracks = None
    if include_tracks:
        mapped_tracks = [map_track(track) for track in tracks_raw if getattr(track, "track", None) is not None]
    duration_ms = getattr(playlist, "duration_ms", None)
    description = (
        getattr(playlist, "description", None)
        or getattr(playlist, "description_formatted", None)
        or getattr(playlist, "og_description", None)
    )
    background = getattr(playlist, "background_color", None)
    if background and not str(background).startswith("#"):
        background = f"#{background}"
    return PlaylistDTO(
        id=playlist_id,
        title=str(getattr(playlist, "title", None) or "Плейлист"),
        subtitle=str(description) if description else None,
        track_count=max(0, int(getattr(playlist, "track_count", None) or len(tracks_raw))),
        duration_minutes=round(int(duration_ms) / 60_000) if duration_ms else None,
        cover_url=_image_url(cover_uri),
        cover_tone=_tone_for(playlist_id),
        accent=str(background) if background else None,
        tracks=mapped_tracks,
    )


def _playlist_identity(playlist: Any) -> str | None:
    owner = getattr(playlist, "uid", None) or getattr(getattr(playlist, "owner", None), "uid", None)
    kind = getattr(playlist, "kind", None)
    if owner is None or kind is None:
        return None
    return f"{owner}:{kind}"


def _image_url(value: Any, size: str = "400x400") -> str | None:
    if not value:
        return None
    url = str(value).strip().replace("%%", size)
    if url.startswith("//"):
        return f"https:{url}"
    if url.startswith("http://"):
        return f"https://{url[7:]}"
    if url.startswith("https://"):
        return url
    return f"https://{url.lstrip('/')}"


def _track_id(track: Any) -> str:
    value = getattr(track, "id", None) or getattr(track, "real_id", None)
    return str(value or "unknown")


def _short_track_id(item: Any) -> str | None:
    value = getattr(item, "track_id", None)
    if value is None:
        value = getattr(item, "id", None)
        album_id = getattr(item, "album_id", None)
        if value is not None and album_id is not None:
            value = f"{value}:{album_id}"
    return str(value) if value is not None else None


def _music_history_track_ids(history: Any) -> list[str]:
    identifiers: list[str] = []
    for tab in list(getattr(history, "history_tabs", None) or []):
        for group in list(getattr(tab, "items", None) or []):
            for item in list(getattr(group, "tracks", None) or []):
                if getattr(item, "type", None) != "track":
                    continue
                data = getattr(item, "data", None)
                item_id = getattr(data, "item_id", None)
                track_id = getattr(item_id, "track_id", None)
                album_id = getattr(item_id, "album_id", None)
                if track_id is not None:
                    identifiers.append(f"{track_id}:{album_id}" if album_id is not None else str(track_id))
    return _dedupe_identifiers(identifiers)


def _identifier_aliases(value: str) -> set[str]:
    identifier = str(value).strip()
    if not identifier:
        return set()
    aliases = {identifier}
    if ":" in identifier:
        aliases.add(identifier.split(":", 1)[0])
    return aliases


def _identifier_aliases_for(values: Iterable[str]) -> set[str]:
    aliases: set[str] = set()
    for value in values:
        aliases.update(_identifier_aliases(value))
    return aliases


def _canonical_identifiers(values: Iterable[str]) -> set[str]:
    return {str(value).split(":", 1)[0] for value in values if str(value).strip()}


def _dedupe_identifiers(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        aliases = _identifier_aliases(value)
        if not aliases or aliases & seen:
            continue
        result.append(str(value))
        seen.update(aliases)
    return result


def _tone_for(value: str) -> str:
    tones = ("lime", "violet", "coral", "blue", "amber", "mono")
    return tones[sum(value.encode("utf-8")) % len(tones)]


def _number_or_text(value: str | int) -> str | int:
    text = str(value)
    return int(text) if text.isdigit() else text


def _parse_playlist_id(value: str, default_owner: str) -> tuple[str, int | str]:
    if ":" in value:
        owner, kind = value.rsplit(":", 1)
    else:
        owner, kind = default_owner, value
    if not owner or not kind:
        raise GatewayNotFound("Playlist was not found")
    return owner, int(kind) if kind.isdigit() else kind


def _extract_playlists(root: Any, *, limit: int) -> list[Any]:
    result: list[Any] = []
    seen_objects: set[int] = set()
    stack: list[tuple[Any, int]] = [(root, 0)]
    while stack and len(result) < limit:
        value, depth = stack.pop()
        if value is None or depth > 9:
            continue
        if isinstance(value, (str, bytes, int, float, bool)):
            continue
        identity = id(value)
        if identity in seen_objects:
            continue
        seen_objects.add(identity)
        if type(value).__name__ == "Playlist":
            result.append(value)
            continue
        if isinstance(value, dict):
            stack.extend((item, depth + 1) for item in value.values())
        elif isinstance(value, (list, tuple, set)):
            stack.extend((item, depth + 1) for item in value)
        elif hasattr(value, "__dict__"):
            stack.extend(
                (item, depth + 1)
                for key, item in vars(value).items()
                if key not in {"client", "_client"}
            )
    return result


def _dedupe_playlists(items: list[Any]) -> list[Any]:
    result: list[Any] = []
    seen: set[tuple[str, str]] = set()
    for item in items:
        key = (str(getattr(item, "uid", "")), str(getattr(item, "kind", "")))
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _dedupe_tracks(items: list[Any]) -> list[Any]:
    result: list[Any] = []
    seen: set[str] = set()
    for item in items:
        key = _track_id(item)
        if key == "unknown" or key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _primary_artist(track: Any) -> str:
    artists = list(getattr(track, "artists", None) or [])
    if not artists:
        return ""
    return str(getattr(artists[0], "id", None) or getattr(artists[0], "name", "")).casefold()


def _balanced_tracks(
    *,
    familiar: list[Any],
    discovery: list[Any],
    target_ms: int,
    discovery_percent: int,
    cooldown_days: int,
) -> list[Any]:
    randomizer = random.SystemRandom()
    familiar_pool = _dedupe_tracks(familiar)
    discovery_pool = _dedupe_tracks(discovery)
    randomizer.shuffle(familiar_pool)
    randomizer.shuffle(discovery_pool)
    target_new = discovery_percent / 100
    artist_window = {7: 4, 30: 6, 90: 8}.get(cooldown_days, 6)
    selected: list[Any] = []
    selected_ids: set[str] = set()
    duration = 0

    while duration < target_ms:
        current_ratio = (
            sum(1 for track in selected if _track_id(track) in {_track_id(x) for x in discovery})
            / len(selected)
            if selected
            else 0
        )
        prefer_discovery = bool(discovery_pool) and current_ratio < target_new
        pools = (discovery_pool, familiar_pool) if prefer_discovery else (familiar_pool, discovery_pool)
        chosen = None
        recent_artists = {_primary_artist(item) for item in selected[-artist_window:]}
        for pool in pools:
            for index, candidate in enumerate(pool):
                if _track_id(candidate) in selected_ids:
                    continue
                artist = _primary_artist(candidate)
                if artist and artist in recent_artists:
                    continue
                chosen = pool.pop(index)
                break
            if chosen is not None:
                break
        if chosen is None:
            for pool in pools:
                while pool and _track_id(pool[0]) in selected_ids:
                    pool.pop(0)
                if pool:
                    chosen = pool.pop(0)
                    break
        if chosen is None:
            break
        selected.append(chosen)
        selected_ids.add(_track_id(chosen))
        duration += max(1, int(getattr(chosen, "duration_ms", None) or 180_000))
    return selected


def _raise_if_authorization_failed(*values: Any) -> None:
    for value in values:
        if isinstance(value, UnauthorizedError):
            raise GatewayUnauthorized("Yandex Music session expired") from value
