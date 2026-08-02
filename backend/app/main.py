from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import math
import re
import secrets
import time
from dataclasses import dataclass
from urllib.parse import quote
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from fastapi.responses import JSONResponse

from .config import Settings, get_settings
from .demo import DEMO_PLAYLISTS, demo_bootstrap, demo_search, demo_session
from .gateway import (
    DeviceAuthorization,
    DeviceFlowRejected,
    GatewayError,
    GatewayNotFound,
    GatewayUnauthorized,
    GatewayUnavailable,
    MusicGateway,
    YandexMusicGateway,
)
from .models import (
    AccessUnlockRequest,
    ActionResponse,
    BootstrapPayload,
    DeviceAuthPollDTO,
    DeviceAuthPollRequest,
    DeviceAuthStartDTO,
    DiscoveryRecommendationsPayload,
    ExternalTrackDTO,
    ListeningEventRequest,
    ListeningStatsPayload,
    ListeningTopDTO,
    LikedTracksPayload,
    LocalPlaylistCreateRequest,
    LocalPlaylistUpdateRequest,
    PlaylistCoverRequest,
    PlaylistShareRequest,
    PlaylistTrackRequest,
    PlaylistDTO,
    PublicShareDTO,
    RecommendationCollectionDTO,
    SearchPayload,
    ShareLinkDTO,
    SessionPayload,
    SessionPreferences,
    TrackDTO,
    TrackShareRequest,
    UserProfileDTO,
    VKImportRequest,
    VKImportResult,
)
from .security import CookieSigner
from .store import Credential, CredentialStore, CredentialStoreError


@dataclass(slots=True)
class PendingAuthorization:
    authorization: DeviceAuthorization
    expires_at: float
    next_poll_at: float


def create_app(
    settings: Settings | None = None,
    *,
    gateway: MusicGateway | None = None,
    store: CredentialStore | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    store = store or CredentialStore(settings.database_path, settings.fernet_key)
    gateway = gateway or YandexMusicGateway(settings)
    signer = CookieSigner(settings.cookie_secret.get_secret_value().encode("utf-8"))
    attempts: dict[str, PendingAuthorization] = {}
    attempts_lock = asyncio.Lock()
    rate_attempts: dict[str, list[float]] = {}
    rate_lock = asyncio.Lock()

    app = FastAPI(
        title="XEDOC Play API",
        version="0.1.0",
        docs_url=None if settings.environment == "production" else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.environment == "production" else "/api/openapi.json",
    )
    app.state.settings = settings
    app.state.credential_store = store
    app.state.music_gateway = gateway
    app.state.device_attempts = attempts

    def set_signed_cookie(response: Response, name: str, purpose: str, ttl_seconds: int) -> None:
        response.set_cookie(
            key=name,
            value=signer.issue(purpose, ttl_seconds),
            max_age=ttl_seconds,
            path="/",
            domain=settings.cookie_domain,
            secure=settings.cookie_secure,
            httponly=True,
            samesite="strict",
        )

    def clear_cookie(response: Response, name: str) -> None:
        response.delete_cookie(
            key=name,
            path="/",
            domain=settings.cookie_domain,
            secure=settings.cookie_secure,
            httponly=True,
            samesite="strict",
        )

    def is_access_unlocked(request: Request) -> bool:
        if not settings.access_key.get_secret_value():
            return True
        return signer.verify(request.cookies.get(settings.access_cookie_name), "access")

    def require_access(request: Request) -> None:
        if not is_access_unlocked(request):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нужен ключ доступа")

    def optional_credential(request: Request) -> Credential | None:
        try:
            credential = store.load()
        except CredentialStoreError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Не удалось прочитать защищённую сессию",
            ) from exc
        if credential is None or not credential.session_id:
            return None
        if not signer.verify(
            request.cookies.get(settings.session_cookie_name),
            f"music-session:{credential.session_id}",
        ):
            return None
        return credential

    def require_credential(request: Request) -> Credential:
        credential = optional_credential(request)
        if credential is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Подключите Яндекс Музыку",
            )
        return credential

    async def enforce_rate_limit(
        request: Request,
        scope: str,
        *,
        maximum: int,
        window_seconds: int,
    ) -> None:
        now = time.monotonic()
        client = request.client.host if request.client else "unknown"
        key = f"{scope}:{client}"
        async with rate_lock:
            recent = [stamp for stamp in rate_attempts.get(key, []) if stamp > now - window_seconds]
            if len(recent) >= maximum:
                retry_after = max(1, int(window_seconds - (now - recent[0])))
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Слишком много попыток. Попробуйте позже.",
                    headers={"Retry-After": str(retry_after)},
                )
            recent.append(now)
            rate_attempts[key] = recent

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        if settings.environment == "production" and request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if origin != settings.public_origin.rstrip("/"):
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={"detail": "Недопустимый источник запроса"},
                )
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    @app.get("/api/health")
    async def health(response: Response) -> dict[str, str | bool]:
        healthy = store.healthy()
        if not healthy:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "ok" if healthy else "degraded",
            "service": "play.xedoc.ru",
            "mode": "private-beta",
            "storage": "ok" if healthy else "error",
            "yandexConfigured": True,
        }

    @app.get("/api/bootstrap", response_model=BootstrapPayload, response_model_exclude_none=True)
    async def bootstrap(request: Request, response: Response) -> BootstrapPayload:
        if not is_access_unlocked(request):
            return demo_bootstrap(access_locked=True)

        credential = optional_credential(request)
        if credential is None:
            return demo_bootstrap()
        try:
            payload = await gateway.bootstrap(credential)
            payload.access_locked = False
            _attach_xedoc_library(payload, store)
            return payload
        except GatewayUnauthorized:
            store.delete()
            clear_cookie(response, settings.session_cookie_name)
            return demo_bootstrap()
        except GatewayError as exc:
            if not settings.demo_fallback:
                raise _http_gateway_error(exc) from exc
            payload = demo_bootstrap()
            payload.connected = True
            payload.demo = True
            payload.user = UserProfileDTO(name=credential.user_name, avatar_url=credential.avatar_url)
            _attach_xedoc_library(payload, store)
            return payload

    @app.get("/api/local-playlists", response_model=list[PlaylistDTO], response_model_exclude_none=True)
    async def local_playlists(_: None = Depends(require_access)) -> list[PlaylistDTO]:
        return [PlaylistDTO.model_validate(item) for item in store.list_local_playlists()]

    @app.post("/api/local-playlists", response_model=PlaylistDTO, response_model_exclude_none=True)
    async def create_local_playlist(
        body: LocalPlaylistCreateRequest,
        request: Request,
        _: None = Depends(require_access),
    ) -> PlaylistDTO:
        require_credential(request)
        return PlaylistDTO.model_validate(store.create_local_playlist(body.title, body.description))

    @app.patch("/api/local-playlists/{playlist_id}", response_model=PlaylistDTO, response_model_exclude_none=True)
    async def update_local_playlist(
        playlist_id: str,
        body: LocalPlaylistUpdateRequest,
        request: Request,
        _: None = Depends(require_access),
    ) -> PlaylistDTO:
        require_credential(request)
        identifier = _safe_local_playlist_id(playlist_id)
        playlist = store.update_local_playlist(identifier, title=body.title, description=body.description)
        return _require_local_playlist(playlist)

    @app.delete("/api/local-playlists/{playlist_id}", response_model=ActionResponse)
    async def delete_local_playlist(
        playlist_id: str,
        request: Request,
        _: None = Depends(require_access),
    ) -> ActionResponse:
        require_credential(request)
        playlist = store.delete_local_playlist(_safe_local_playlist_id(playlist_id))
        _require_local_playlist(playlist)
        return ActionResponse()

    @app.put("/api/local-playlists/{playlist_id}/cover", response_model=PlaylistDTO, response_model_exclude_none=True)
    async def update_local_playlist_cover(
        playlist_id: str,
        body: PlaylistCoverRequest,
        request: Request,
        _: None = Depends(require_access),
    ) -> PlaylistDTO:
        require_credential(request)
        data_url = _safe_cover_data_url(body.data_url)
        playlist = store.update_local_playlist(_safe_local_playlist_id(playlist_id), cover_url=data_url, update_cover=True)
        return _require_local_playlist(playlist)

    @app.post("/api/local-playlists/{playlist_id}/tracks", response_model=PlaylistDTO, response_model_exclude_none=True)
    async def add_local_playlist_track(
        playlist_id: str,
        body: PlaylistTrackRequest,
        request: Request,
        _: None = Depends(require_access),
    ) -> PlaylistDTO:
        require_credential(request)
        track = body.track.model_copy(update={
            "stream_url": None,
            "play_count": None,
            "total_listened_ms": None,
            "last_played_at": None,
        })
        if track.id.startswith("demo-"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Демо-трек нельзя сохранить")
        playlist = store.add_local_playlist_track(
            _safe_local_playlist_id(playlist_id),
            _safe_identifier(track.id),
            track.model_dump(mode="json", by_alias=True, exclude_none=True),
        )
        return _require_local_playlist(playlist)

    @app.delete("/api/local-playlists/{playlist_id}/tracks/{track_id}", response_model=PlaylistDTO, response_model_exclude_none=True)
    async def remove_local_playlist_track(
        playlist_id: str,
        track_id: str,
        request: Request,
        _: None = Depends(require_access),
    ) -> PlaylistDTO:
        require_credential(request)
        playlist = store.remove_local_playlist_track(_safe_local_playlist_id(playlist_id), _safe_identifier(track_id))
        return _require_local_playlist(playlist)

    @app.post("/api/listening-events", response_model=ActionResponse)
    async def record_listening_event(
        body: ListeningEventRequest,
        request: Request,
        _: None = Depends(require_access),
    ) -> ActionResponse:
        require_credential(request)
        track = body.track.model_copy(update={"stream_url": None})
        if not track.id.startswith("demo-"):
            store.save_listening_event(
                _safe_identifier(track.id),
                track.model_dump(mode="json", by_alias=True, exclude_none=True),
                body.listened_ms,
                body.source,
            )
        return ActionResponse()

    @app.post("/api/import/vk", response_model=VKImportResult, response_model_exclude_none=True)
    async def import_vk_collection(
        body: VKImportRequest,
        request: Request,
        _: None = Depends(require_access),
    ) -> VKImportResult:
        credential = require_credential(request)
        semaphore = asyncio.Semaphore(4)

        async def match(external: ExternalTrackDTO) -> tuple[ExternalTrackDTO, TrackDTO | None]:
            async with semaphore:
                try:
                    result = await gateway.search(credential, f"{external.artist} {external.title}")
                except GatewayError:
                    return external, None
            wanted_title = _normalize_music_text(external.title)
            wanted_artist = _normalize_music_text(external.artist)
            best: tuple[float, TrackDTO] | None = None
            for candidate in result.tracks:
                title = _normalize_music_text(candidate.title)
                artists = _normalize_music_text(" ".join(candidate.artists))
                title_score = 5 if title == wanted_title else 2 if title in wanted_title or wanted_title in title else 0
                artist_score = 4 if artists == wanted_artist else 2 if artists in wanted_artist or wanted_artist in artists else 0
                overlap = len(set(wanted_artist.split()) & set(artists.split()))
                score = title_score + artist_score + min(2, overlap)
                if score >= 6 and (best is None or score > best[0]):
                    best = (score, candidate)
            return external, best[1] if best else None

        results = await asyncio.gather(*(match(track) for track in body.tracks))
        matched_tracks: dict[str, TrackDTO] = {}
        unmatched: list[ExternalTrackDTO] = []
        for external, track in results:
            seed = track or TrackDTO(
                id=f"vk-seed-{hashlib.sha1(f'{external.artist}|{external.title}'.encode()).hexdigest()[:20]}",
                title=external.title,
                artists=[external.artist],
                duration_ms=0,
            )
            store.save_listening_event(
                seed.id,
                seed.model_dump(mode="json", by_alias=True, exclude_none=True),
                45_000,
                "vk_seed",
            )
            if track:
                matched_tracks.setdefault(track.id, track)
            else:
                unmatched.append(external)

        description = (
            f"Импортировано из {body.source_url}\n"
            f"Совпало с каталогом Яндекс Музыки: {len(matched_tracks)} из {len(body.tracks)}. "
            "Список также используется как сигнал для рекомендаций XEDOC."
        )
        playlist_data = next(
            (item for item in store.list_local_playlists() if item["title"] == "Музыка из VK" and body.source_url in (item.get("description") or "")),
            None,
        )
        if playlist_data:
            playlist_data = store.update_local_playlist(playlist_data["id"], description=description) or playlist_data
        else:
            playlist_data = store.create_local_playlist("Музыка из VK", description)
        playlist_id = playlist_data["id"]
        for track in matched_tracks.values():
            store.add_local_playlist_track(
                playlist_id,
                track.id,
                track.model_copy(update={"stream_url": None}).model_dump(mode="json", by_alias=True, exclude_none=True),
            )
        playlist = _require_local_playlist(store.load_local_playlist(playlist_id))
        return VKImportResult(playlist=playlist, matched=len(matched_tracks), unmatched=unmatched)

    @app.post("/api/access/unlock", response_model=ActionResponse)
    async def unlock(body: AccessUnlockRequest, request: Request, response: Response) -> ActionResponse:
        await enforce_rate_limit(request, "unlock", maximum=10, window_seconds=300)
        expected = settings.access_key.get_secret_value()
        if expected and not hmac.compare_digest(body.key.encode("utf-8"), expected.encode("utf-8")):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный ключ доступа")
        set_signed_cookie(
            response,
            settings.access_cookie_name,
            "access",
            settings.access_ttl_hours * 3600,
        )
        return ActionResponse()

    @app.post(
        "/api/auth/device/start",
        response_model=DeviceAuthStartDTO,
        response_model_exclude_none=True,
    )
    async def start_device_auth(
        request: Request,
        _: None = Depends(require_access),
    ) -> DeviceAuthStartDTO:
        await enforce_rate_limit(request, "device-start", maximum=5, window_seconds=600)
        try:
            authorization = await gateway.start_device_auth()
        except GatewayError as exc:
            raise _http_gateway_error(exc) from exc

        attempt_id = secrets.token_urlsafe(32)
        now = time.monotonic()
        pending = PendingAuthorization(
            authorization=authorization,
            expires_at=now + authorization.expires_in,
            next_poll_at=now + max(0, authorization.interval),
        )
        async with attempts_lock:
            expired = [key for key, value in attempts.items() if value.expires_at <= now]
            for key in expired:
                attempts.pop(key, None)
            if len(attempts) >= 16:
                oldest = min(attempts, key=lambda key: attempts[key].expires_at)
                attempts.pop(oldest, None)
            attempts[attempt_id] = pending

        return DeviceAuthStartDTO(
            device_id=attempt_id,
            user_code=authorization.user_code,
            verification_url=authorization.verification_url,
            expires_in=authorization.expires_in,
            interval=authorization.interval,
        )

    @app.post("/api/auth/device/poll", response_model=DeviceAuthPollDTO)
    async def poll_device_auth(
        body: DeviceAuthPollRequest,
        response: Response,
        _: None = Depends(require_access),
    ) -> DeviceAuthPollDTO:
        now = time.monotonic()
        async with attempts_lock:
            pending = attempts.get(body.device_id)
            if pending is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Код подключения не найден")
            if pending.expires_at <= now:
                attempts.pop(body.device_id, None)
                raise HTTPException(status_code=status.HTTP_410_GONE, detail="Код подключения истёк")
            if pending.next_poll_at > now:
                return DeviceAuthPollDTO(connected=False)
            pending.next_poll_at = now + max(3, pending.authorization.interval)

        try:
            credential = await gateway.poll_device_auth(pending.authorization)
        except DeviceFlowRejected as exc:
            async with attempts_lock:
                attempts.pop(body.device_id, None)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        except GatewayError as exc:
            raise _http_gateway_error(exc) from exc

        if credential is None:
            return DeviceAuthPollDTO(connected=False)

        if not store.bind_user_uid(credential.user_uid):
            async with attempts_lock:
                attempts.pop(body.device_id, None)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="XEDOC Play уже привязан к другому Яндекс-аккаунту",
            )

        credential.session_id = secrets.token_urlsafe(24)
        store.save(credential)
        async with attempts_lock:
            attempts.pop(body.device_id, None)
        set_signed_cookie(
            response,
            settings.session_cookie_name,
            f"music-session:{credential.session_id}",
            settings.session_ttl_days * 86400,
        )
        return DeviceAuthPollDTO(connected=True)

    @app.post("/api/auth/logout", response_model=ActionResponse)
    async def logout(response: Response, _: None = Depends(require_access)) -> ActionResponse:
        store.delete()
        async with attempts_lock:
            attempts.clear()
        clear_cookie(response, settings.session_cookie_name)
        return ActionResponse()

    @app.get("/api/search", response_model=SearchPayload, response_model_exclude_none=True)
    async def search(
        request: Request,
        q: str = Query(min_length=1, max_length=200),
        _: None = Depends(require_access),
    ) -> SearchPayload:
        query = q.strip()
        if not query:
            return SearchPayload()
        credential = optional_credential(request)
        if credential is None:
            return demo_search(query)
        try:
            result = await gateway.search(credential, query)
            _decorate_tracks_with_stats(result.tracks, store)
            return result
        except GatewayUnauthorized as exc:
            store.delete()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        except GatewayError as exc:
            if settings.demo_fallback:
                return demo_search(query)
            raise _http_gateway_error(exc) from exc

    @app.get("/api/liked-tracks", response_model=LikedTracksPayload, response_model_exclude_none=True)
    async def liked_tracks(
        request: Request,
        _: None = Depends(require_access),
    ) -> LikedTracksPayload:
        credential = optional_credential(request)
        if credential is None:
            demo = demo_bootstrap()
            return LikedTracksPayload(tracks=demo.liked_tracks, total=demo.liked_count)
        try:
            result = await gateway.liked_tracks(credential)
            _decorate_tracks_with_stats(result.tracks, store)
            return result
        except GatewayError as exc:
            raise _http_gateway_error(exc) from exc

    @app.get(
        "/api/discovery-recommendations",
        response_model=DiscoveryRecommendationsPayload,
        response_model_exclude_none=True,
    )
    async def discovery_recommendations(
        request: Request,
        _: None = Depends(require_access),
    ) -> DiscoveryRecommendationsPayload:
        credential = require_credential(request)
        seed_track_ids, known_track_ids = _discovery_context(store)
        try:
            return await gateway.discovery_recommendations(
                credential,
                seed_track_ids,
                known_track_ids,
            )
        except GatewayError as exc:
            raise _http_gateway_error(exc) from exc

    @app.get("/api/listening-stats", response_model=ListeningStatsPayload, response_model_exclude_none=True)
    async def listening_stats(
        request: Request,
        _: None = Depends(require_access),
    ) -> ListeningStatsPayload:
        require_credential(request)
        periods: list[tuple[str, str, int | None]] = [
            ("day", "За день", 1),
            ("three-days", "За 3 дня", 3),
            ("week", "За неделю", 7),
            ("month", "За месяц", 30),
            ("all-time", "За всё время", None),
        ]
        top: list[ListeningTopDTO] = []
        for identifier, title, days in periods:
            tracks: list[TrackDTO] = []
            rows = store.top_tracks(days=days, limit=200)
            for row in rows:
                try:
                    track = TrackDTO.model_validate(row["track"])
                except ValueError:
                    continue
                tracks.append(track.model_copy(update={
                    "play_count": row["play_count"],
                    "total_listened_ms": row["total_listened_ms"],
                    "last_played_at": row["last_played_at"],
                }))
            top.append(ListeningTopDTO(
                id=identifier,
                title=title,
                period_days=days,
                total_plays=sum(track.play_count or 0 for track in tracks),
                tracks=tracks,
            ))
        all_stats = store.list_track_stats()
        return ListeningStatsPayload(
            total_plays=sum(item["play_count"] for item in all_stats.values()),
            unique_tracks=len(all_stats),
            total_listened_ms=sum(item["total_listened_ms"] for item in all_stats.values()),
            top=top,
        )

    @app.put("/api/tracks/{track_id}/like", response_model=ActionResponse)
    async def like_track(
        track_id: str,
        request: Request,
        _: None = Depends(require_access),
    ) -> ActionResponse:
        credential = require_credential(request)
        try:
            await gateway.set_like(credential, _safe_identifier(track_id), True)
            return ActionResponse()
        except GatewayError as exc:
            raise _http_gateway_error(exc) from exc

    @app.delete("/api/tracks/{track_id}/like", response_model=ActionResponse)
    async def unlike_track(
        track_id: str,
        request: Request,
        _: None = Depends(require_access),
    ) -> ActionResponse:
        credential = require_credential(request)
        try:
            await gateway.set_like(credential, _safe_identifier(track_id), False)
            return ActionResponse()
        except GatewayError as exc:
            raise _http_gateway_error(exc) from exc

    @app.get("/api/tracks/{track_id}/stream", response_class=RedirectResponse)
    async def stream_track(
        track_id: str,
        request: Request,
        _: None = Depends(require_access),
    ) -> RedirectResponse:
        credential = require_credential(request)
        try:
            url = await gateway.stream_url(credential, _safe_identifier(track_id))
        except GatewayError as exc:
            raise _http_gateway_error(exc) from exc
        return RedirectResponse(
            url=url,
            status_code=status.HTTP_307_TEMPORARY_REDIRECT,
            headers={
                "Cache-Control": "private, no-store, max-age=0",
                "Referrer-Policy": "no-referrer",
            },
        )

    @app.post("/api/shares/tracks", response_model=ShareLinkDTO)
    async def create_track_share(
        body: TrackShareRequest,
        request: Request,
        _: None = Depends(require_access),
    ) -> ShareLinkDTO:
        credential = require_credential(request)
        track_id = _safe_identifier(body.track.id)
        if track_id.startswith("demo-"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Демо-трек нельзя опубликовать")
        track = _sanitize_shared_track(body.track.model_copy(update={"id": track_id}))
        share = store.save_public_share(
            kind="track",
            resource_id=track_id,
            payload=track.model_dump(mode="json", by_alias=True, exclude_none=True),
            owner_name=credential.user_name,
        )
        return ShareLinkDTO(token=share.token, path=f"/share/{share.token}")

    @app.post("/api/shares/playlists", response_model=ShareLinkDTO)
    async def create_playlist_share(
        body: PlaylistShareRequest,
        request: Request,
        _: None = Depends(require_access),
    ) -> ShareLinkDTO:
        credential = require_credential(request)
        playlist_id = _safe_identifier(body.playlist_id)
        if playlist_id.startswith("local-"):
            playlist = _require_local_playlist(store.load_local_playlist(_safe_local_playlist_id(playlist_id)))
        else:
            try:
                playlist = await gateway.playlist(credential, playlist_id)
            except GatewayError as exc:
                raise _http_gateway_error(exc) from exc
        playlist = _sanitize_shared_playlist(playlist)
        share = store.save_public_share(
            kind="playlist",
            resource_id=playlist_id,
            payload=playlist.model_dump(mode="json", by_alias=True, exclude_none=True),
            owner_name=credential.user_name,
        )
        return ShareLinkDTO(token=share.token, path=f"/share/{share.token}")

    @app.get(
        "/api/shares/{token}",
        response_model=PublicShareDTO,
        response_model_exclude_none=True,
    )
    async def public_share(token: str, request: Request) -> PublicShareDTO:
        await enforce_rate_limit(request, "public-share", maximum=120, window_seconds=60)
        share = _load_public_share(store, token)
        if share.kind == "track":
            track = TrackDTO.model_validate(share.payload)
            track.stream_url = _public_stream_path(share.token, track.id)
            return PublicShareDTO(
                token=share.token,
                kind="track",
                shared_by=share.owner_name,
                created_at=share.created_at,
                track=track,
            )
        playlist = PlaylistDTO.model_validate(share.payload)
        playlist.tracks = [
            track.model_copy(update={"stream_url": _public_stream_path(share.token, track.id)})
            for track in (playlist.tracks or [])
        ]
        return PublicShareDTO(
            token=share.token,
            kind="playlist",
            shared_by=share.owner_name,
            created_at=share.created_at,
            playlist=playlist,
        )

    @app.get(
        "/api/shares/{token}/tracks/{track_id}/stream",
        response_class=RedirectResponse,
    )
    async def public_share_stream(
        token: str,
        track_id: str,
        request: Request,
    ) -> RedirectResponse:
        await enforce_rate_limit(request, "public-stream", maximum=240, window_seconds=60)
        share = _load_public_share(store, token)
        identifier = _safe_identifier(track_id)
        allowed_ids = _shared_track_ids(share.kind, share.payload)
        if identifier not in allowed_ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Трек не входит в эту публичную ссылку")
        try:
            credential = store.load()
        except CredentialStoreError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Музыка временно недоступна") from exc
        if credential is None:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="Владелец отключил музыкальную коллекцию")
        try:
            url = await gateway.stream_url(credential, identifier)
        except GatewayError as exc:
            raise _http_gateway_error(exc) from exc
        return RedirectResponse(
            url=url,
            status_code=status.HTTP_307_TEMPORARY_REDIRECT,
            headers={
                "Cache-Control": "public, no-store, max-age=0",
                "Referrer-Policy": "no-referrer",
            },
        )

    @app.get(
        "/api/playlists/{playlist_id}",
        response_model=PlaylistDTO,
        response_model_exclude_none=True,
    )
    async def playlist_detail(
        playlist_id: str,
        request: Request,
        _: None = Depends(require_access),
    ) -> PlaylistDTO:
        identifier = _safe_identifier(playlist_id)
        if identifier.startswith("local-"):
            playlist = _require_local_playlist(store.load_local_playlist(_safe_local_playlist_id(identifier)))
            _decorate_tracks_with_stats(playlist.tracks or [], store)
            return playlist
        credential = optional_credential(request)
        if credential is None:
            demo = next((item for item in DEMO_PLAYLISTS if item.id == identifier), None)
            if demo is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Плейлист не найден")
            return demo
        try:
            playlist = await gateway.playlist(credential, identifier)
            _decorate_tracks_with_stats(playlist.tracks or [], store)
            return playlist
        except GatewayError as exc:
            raise _http_gateway_error(exc) from exc

    @app.post("/api/sessions/build", response_model=SessionPayload, response_model_exclude_none=True)
    async def build_session(
        preferences: SessionPreferences,
        request: Request,
        _: None = Depends(require_access),
    ) -> SessionPayload:
        credential = optional_credential(request)
        if credential is None:
            return demo_session(preferences)
        try:
            session = await gateway.build_session(credential, preferences)
            _decorate_tracks_with_stats(session.tracks, store)
            return session
        except GatewayUnauthorized as exc:
            store.delete()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        except GatewayError as exc:
            if settings.demo_fallback:
                return demo_session(preferences)
            raise _http_gateway_error(exc) from exc

    return app


def _safe_identifier(value: str) -> str:
    value = value.strip()
    if not value or len(value) > 256 or any(char in value for char in ("/", "\\", "\x00")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректный идентификатор")
    return value


def _normalize_music_text(value: str) -> str:
    normalized = value.casefold().replace("ё", "е").replace("feat.", " ").replace("ft.", " ")
    return " ".join(re.sub(r"[^a-zа-я0-9]+", " ", normalized).split())


def _safe_local_playlist_id(value: str) -> str:
    identifier = _safe_identifier(value)
    if not identifier.startswith("local-"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректный плейлист XEDOC")
    return identifier


def _require_local_playlist(value: dict | None) -> PlaylistDTO:
    if value is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Плейлист XEDOC не найден")
    return PlaylistDTO.model_validate(value)


def _safe_cover_data_url(value: str) -> str:
    prefixes = {
        "data:image/jpeg;base64,": b"\xff\xd8\xff",
        "data:image/png;base64,": b"\x89PNG\r\n\x1a\n",
        "data:image/webp;base64,": b"RIFF",
    }
    prefix = next((item for item in prefixes if value.startswith(item)), None)
    if prefix is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Поддерживаются JPEG, PNG и WebP")
    try:
        payload = base64.b64decode(value[len(prefix):], validate=True)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Изображение повреждено") from exc
    if len(payload) > 1_200_000 or len(payload) < 32 or not payload.startswith(prefixes[prefix]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Изображение повреждено или слишком велико")
    if prefix.endswith("webp;base64,") and payload[8:12] != b"WEBP":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Изображение повреждено")
    return value


def _decorate_tracks_with_stats(tracks: list[TrackDTO], store: CredentialStore) -> None:
    stats = store.list_track_stats()
    for track in tracks:
        item = stats.get(track.id)
        if item:
            track.play_count = item["play_count"]
            track.total_listened_ms = item["total_listened_ms"]
            track.last_played_at = item["last_played_at"]


def _discovery_context(store: CredentialStore) -> tuple[list[str], set[str]]:
    events = store.list_listening_events(3000)
    known_track_ids = set(store.list_track_stats())
    recent_player_ids: list[str] = []
    fallback_signal_ids: list[str] = []
    for event in events:
        track_id = str(event.get("track_id") or "").strip()
        if not track_id:
            continue
        known_track_ids.add(track_id)
        if event.get("source") == "player" and track_id not in recent_player_ids:
            recent_player_ids.append(track_id)
        elif track_id not in fallback_signal_ids:
            fallback_signal_ids.append(track_id)

    for summary in store.list_local_playlists():
        playlist = store.load_local_playlist(summary["id"])
        for item in (playlist or {}).get("tracks", []):
            track_id = str(item.get("id") or "").strip()
            if track_id:
                known_track_ids.add(track_id)

    seeds = recent_player_ids[:8] or fallback_signal_ids[:8]
    return seeds, known_track_ids


def _attach_xedoc_library(payload: BootstrapPayload, store: CredentialStore) -> None:
    payload.local_playlists = [PlaylistDTO.model_validate(item) for item in store.list_local_playlists()]
    _decorate_tracks_with_stats([*payload.quick_tracks, *payload.liked_tracks, *payload.rediscover], store)
    candidates: dict[str, TrackDTO] = {}
    for track in [*payload.quick_tracks, *payload.liked_tracks, *payload.rediscover]:
        candidates.setdefault(track.id, track)
    for summary in store.list_local_playlists():
        full = store.load_local_playlist(summary["id"])
        for item in (full or {}).get("tracks", []):
            try:
                track = TrackDTO.model_validate(item)
            except ValueError:
                continue
            _decorate_tracks_with_stats([track], store)
            candidates.setdefault(track.id, track)

    events = store.list_listening_events(3000)
    artist_affinity: dict[str, float] = {}
    recent_track_ids: set[str] = set()
    now = int(time.time())
    for index, event in enumerate(events):
        try:
            track = TrackDTO.model_validate(event["track"])
        except ValueError:
            continue
        age_days = max(0, (now - int(event["created_at"])) / 86_400)
        recency = math.exp(-age_days / 120)
        duration_weight = min(2.0, max(.35, int(event["listened_ms"]) / 45_000))
        source_weight = 2.2 if event["source"] == "vk_seed" else 1.0
        weight = recency * duration_weight * source_weight
        for artist in track.artists:
            key = artist.casefold().strip()
            artist_affinity[key] = artist_affinity.get(key, 0.0) + weight
        if index < 30:
            recent_track_ids.add(track.id)

    scored: list[tuple[float, TrackDTO]] = []
    for position, track in enumerate(candidates.values()):
        affinity = sum(artist_affinity.get(artist.casefold().strip(), 0) for artist in track.artists)
        discovery = 1.4 if track.id not in recent_track_ids else -3.5
        liked = 1.8 if track.liked else 0
        scored.append((affinity + discovery + liked - position * .002, track))
    scored.sort(key=lambda item: item[0], reverse=True)
    artist_counts: dict[str, int] = {}
    recommendations: list[TrackDTO] = []
    for _, track in scored:
        artist_key = track.artists[0].casefold().strip() if track.artists else ""
        if artist_counts.get(artist_key, 0) >= 2:
            continue
        recommendations.append(track)
        artist_counts[artist_key] = artist_counts.get(artist_key, 0) + 1
        if len(recommendations) >= 12:
            break
    payload.xedoc_recommendations = recommendations
    if events:
        payload.recommendation_insight = f"Учли {len(events)} сигналов прослушивания · больше знакомого, меньше недавних повторов"
    else:
        payload.recommendation_insight = "Начинаем с вашей коллекции и станем точнее после первых прослушиваний"

    periods: list[tuple[int, str, str]] = [
        (1, "Лучшее за день", "Ваш ритм за последние 24 часа"),
        (3, "Главное за 3 дня", "Треки, к которым вы возвращались последние 72 часа"),
        (7, "Неделя в музыке", "Самое заметное за последние семь дней"),
        (30, "Лучшее за месяц", "Ваша музыкальная картина за последние 30 дней"),
    ]
    player_events = [event for event in events if event["source"] == "player"]
    collections: list[RecommendationCollectionDTO] = []
    for period_index, (days, title, subtitle) in enumerate(periods):
        cutoff = now - days * 86_400
        period_events = [event for event in player_events if int(event["created_at"]) >= cutoff]
        by_track: dict[str, dict] = {}
        for event in period_events:
            track_id = str(event["track_id"])
            bucket = by_track.setdefault(
                track_id,
                {"track": event["track"], "plays": 0, "listened_ms": 0, "latest": 0},
            )
            bucket["plays"] += 1
            bucket["listened_ms"] += int(event["listened_ms"])
            bucket["latest"] = max(bucket["latest"], int(event["created_at"]))
        ranked: list[tuple[float, TrackDTO]] = []
        for item in by_track.values():
            try:
                track = TrackDTO.model_validate(item["track"])
            except ValueError:
                continue
            age_hours = max(0, (now - item["latest"]) / 3600)
            score = item["plays"] * 4 + min(4, item["listened_ms"] / 60_000) + math.exp(-age_hours / max(24, days * 12))
            ranked.append((score, track))
        ranked.sort(key=lambda item: item[0], reverse=True)
        period_tracks = [track for _, track in ranked[:20]]
        fallback = not period_tracks
        if fallback and recommendations:
            offset = (period_index * 3) % len(recommendations)
            period_tracks = (recommendations[offset:] + recommendations[:offset])[:12]
            subtitle = f"{subtitle} · пока дополняем рекомендациями по вашему вкусу"
        collections.append(RecommendationCollectionDTO(
            id=f"xedoc-best-{days}d",
            title=title,
            subtitle=subtitle,
            period_days=days,
            signal_count=len(period_events),
            fallback=fallback,
            tracks=period_tracks,
        ))
    payload.xedoc_collections = collections


def _safe_share_token(value: str) -> str:
    value = value.strip()
    if not 20 <= len(value) <= 80 or any(not (char.isalnum() or char in "_-") for char in value):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публичная ссылка не найдена")
    return value


def _load_public_share(store: CredentialStore, token: str):
    share = store.load_public_share(_safe_share_token(token))
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публичная ссылка не найдена")
    return share


def _public_stream_path(token: str, track_id: str) -> str:
    return f"/api/shares/{quote(token, safe='')}/tracks/{quote(track_id, safe='')}/stream"


def _sanitize_shared_track(track: TrackDTO) -> TrackDTO:
    return track.model_copy(update={
        "liked": None,
        "stream_url": None,
        "play_count": None,
        "total_listened_ms": None,
        "last_played_at": None,
    })


def _sanitize_shared_playlist(playlist: PlaylistDTO) -> PlaylistDTO:
    return playlist.model_copy(
        update={"tracks": [_sanitize_shared_track(track) for track in (playlist.tracks or [])]},
    )


def _shared_track_ids(kind: str, payload: dict) -> set[str]:
    if kind == "track":
        return {TrackDTO.model_validate(payload).id}
    playlist = PlaylistDTO.model_validate(payload)
    return {track.id for track in (playlist.tracks or [])}


def _http_gateway_error(error: GatewayError) -> HTTPException:
    if isinstance(error, GatewayUnauthorized):
        return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error))
    if isinstance(error, GatewayNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    if isinstance(error, DeviceFlowRejected):
        return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error))
    if isinstance(error, GatewayUnavailable):
        return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error))
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Yandex Music is unavailable")


app = create_app()
