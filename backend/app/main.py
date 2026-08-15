from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import math
import re
import secrets
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from urllib.parse import quote, urlparse
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse

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
    AccountLoginRequest,
    AccountPasswordRequest,
    AccountRegisterRequest,
    AccessUnlockRequest,
    ActionResponse,
    AdminDashboardDTO,
    AppUserDTO,
    BootstrapPayload,
    DeviceAuthPollDTO,
    DeviceAuthPollRequest,
    DeviceAuthStartDTO,
    DiscoveryRecommendationsPayload,
    ExternalTrackDTO,
    FriendStatusDTO,
    FriendsPayload,
    ListeningEventRequest,
    NowPlayingRequest,
    ListeningStatsPayload,
    ListeningTopDTO,
    LikedTracksPayload,
    LocalPlaylistCreateRequest,
    LocalPlaylistUpdateRequest,
    PlaylistCoverRequest,
    PlaylistShareRequest,
    PlaylistTrackRequest,
    PlaylistDTO,
    ProfileSearchItemDTO,
    PublicProfileDTO,
    PublicNowPlayingDTO,
    PublicShareDTO,
    PollVoteRequest,
    RecommendationCollectionDTO,
    SearchPayload,
    SocialFeedDTO,
    SocialPostCreateRequest,
    SocialPostDTO,
    ShareLinkDTO,
    SessionPayload,
    SessionPreferences,
    TrackDTO,
    TrackShareRequest,
    UserProfileDTO,
    VKImportRequest,
    VKImportResult,
    VKImportJobDTO,
)
from .security import CookieSigner, hash_password, session_token_hash, verify_password
from .store import ANONYMOUS_USER_ID, LEGACY_USER_ID, AppUser, Credential, CredentialStore, CredentialStoreError


@dataclass(slots=True)
class PendingAuthorization:
    authorization: DeviceAuthorization
    expires_at: float
    next_poll_at: float
    owner_id: str


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
    vk_job_tasks: set[asyncio.Task[None]] = set()

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

    def issue_user_session(response: Response, user: AppUser) -> None:
        raw_token = secrets.token_urlsafe(32)
        ttl_seconds = settings.session_ttl_days * 86_400
        store.save_app_session(session_token_hash(raw_token), user.id, int(time.time()) + ttl_seconds)
        response.set_cookie(
            key=settings.user_cookie_name,
            value=raw_token,
            max_age=ttl_seconds,
            path="/",
            domain=settings.cookie_domain,
            secure=settings.cookie_secure,
            httponly=True,
            samesite="strict",
        )

    def app_user_dto(user: AppUser) -> AppUserDTO:
        return AppUserDTO(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            needs_password=user.password_hash is None,
            is_admin=user.is_admin,
        )

    def optional_app_user(request: Request) -> AppUser | None:
        return getattr(request.state, "app_user", None)

    def require_app_user(request: Request) -> AppUser:
        user = optional_app_user(request)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Войдите в XEDOC Play")
        return user

    def require_admin(request: Request) -> AppUser:
        user = require_app_user(request)
        if not user.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступ только для администратора")
        return user

    def is_access_unlocked(request: Request) -> bool:
        if not settings.access_key.get_secret_value():
            return True
        return signer.verify(request.cookies.get(settings.access_cookie_name), "access")

    def require_access(request: Request) -> None:
        require_app_user(request)

    def optional_credential(request: Request) -> Credential | None:
        if optional_app_user(request) is None:
            return None
        try:
            credential = store.load()
        except CredentialStoreError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Не удалось прочитать защищённую сессию",
            ) from exc
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

    async def match_vk_track(
        credential: Credential | None,
        external: ExternalTrackDTO,
        semaphore: asyncio.Semaphore,
    ) -> tuple[ExternalTrackDTO, TrackDTO | None]:
        if credential is None:
            return external, None
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

    def existing_vk_seed_keys() -> set[tuple[str, str]]:
        keys: set[tuple[str, str]] = set()
        for event in store.list_listening_events(30_000):
            if event.get("source") != "vk_seed":
                continue
            track = event.get("track") or {}
            title = _normalize_music_text(str(track.get("title") or ""))
            artists = track.get("artists") or []
            artist = _normalize_music_text(str(artists[0] if artists else ""))
            if title and artist:
                keys.add((artist, title))
        return keys

    def save_vk_seed(
        external: ExternalTrackDTO,
        track: TrackDTO | None,
        known_keys: set[tuple[str, str]],
    ) -> None:
        key = (_normalize_music_text(external.artist), _normalize_music_text(external.title))
        if key in known_keys:
            return
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
        known_keys.add(key)

    def ensure_vk_playlist(source_url: str, total: int) -> str:
        description = (
            f"Импортировано из {source_url}\n"
            f"Собираем доступные версии для {total} треков. "
            "Весь список уже используется как сигнал для рекомендаций XEDOC."
        )
        playlist_data = next(
            (
                item for item in store.list_local_playlists()
                if item["title"] == "Музыка из VK" and source_url in (item.get("description") or "")
            ),
            None,
        )
        if playlist_data:
            playlist_data = store.update_local_playlist(playlist_data["id"], description=description) or playlist_data
        else:
            playlist_data = store.create_local_playlist("Музыка из VK", description)
        return str(playlist_data["id"])

    async def process_vk_import_job(job_id: str, owner_id: str) -> None:
        tenant_token = store.set_current_user(owner_id)
        try:
            job = store.load_vk_import_job(job_id)
            if not job:
                return
            store.update_vk_import_job(job_id, status="running")
            credential = store.load()
            tracks = [ExternalTrackDTO.model_validate(item) for item in job["tracks"]]
            playlist_id = ensure_vk_playlist(job["source_url"], len(tracks))
            store.update_vk_import_job(job_id, playlist_id=playlist_id)
            known_keys = existing_vk_seed_keys()
            matched = int(job["matched"])
            processed = int(job["processed"])
            semaphore = asyncio.Semaphore(4)
            for offset in range(processed, len(tracks), 20):
                chunk = tracks[offset:offset + 20]
                results = await asyncio.gather(
                    *(match_vk_track(credential, external, semaphore) for external in chunk)
                )
                for external, track in results:
                    save_vk_seed(external, track, known_keys)
                    if track:
                        matched += 1
                        store.add_local_playlist_track(
                            playlist_id,
                            track.id,
                            track.model_copy(update={"stream_url": None}).model_dump(
                                mode="json", by_alias=True, exclude_none=True
                            ),
                        )
                processed += len(results)
                store.update_vk_import_job(
                    job_id,
                    processed=processed,
                    matched=matched,
                    unmatched=processed - matched,
                )
            store.update_local_playlist(
                playlist_id,
                description=(
                    f"Импортировано из {job['source_url']}\n"
                    f"Найдено в подключённом каталоге: {matched} из {len(tracks)}. "
                    "Весь список учитывается в рекомендациях XEDOC."
                ),
            )
            store.update_vk_import_job(
                job_id,
                status="complete",
                processed=len(tracks),
                matched=matched,
                unmatched=len(tracks) - matched,
            )
        except Exception:
            store.update_vk_import_job(
                job_id,
                status="failed",
                error="Не удалось завершить сопоставление. Запустите импорт ещё раз.",
            )
        finally:
            store.reset_current_user(tenant_token)

    def schedule_vk_import_job(job_id: str, owner_id: str) -> None:
        task = asyncio.create_task(process_vk_import_job(job_id, owner_id))
        vk_job_tasks.add(task)
        task.add_done_callback(vk_job_tasks.discard)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        for job in store.incomplete_vk_import_jobs():
            schedule_vk_import_job(str(job["id"]), str(job["user_id"]))
        yield
        for task in vk_job_tasks:
            task.cancel()
        if vk_job_tasks:
            await asyncio.gather(*vk_job_tasks, return_exceptions=True)

    app.router.lifespan_context = lifespan

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        raw_session = request.cookies.get(settings.user_cookie_name)
        user = store.user_for_app_session(session_token_hash(raw_session)) if raw_session else None
        migrated_legacy_session = False
        if user is None and is_access_unlocked(request):
            legacy_credential = store.load_for_user(LEGACY_USER_ID)
            if legacy_credential and legacy_credential.session_id and signer.verify(
                request.cookies.get(settings.session_cookie_name),
                f"music-session:{legacy_credential.session_id}",
            ):
                user = store.user_by_id(LEGACY_USER_ID)
                migrated_legacy_session = user is not None
        request.state.app_user = user
        tenant_token = store.set_current_user(user.id if user else ANONYMOUS_USER_ID)
        if settings.environment == "production" and request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if origin != settings.public_origin.rstrip("/"):
                store.reset_current_user(tenant_token)
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={"detail": "Недопустимый источник запроса"},
                )
        try:
            response = await call_next(request)
            if migrated_legacy_session and user is not None:
                issue_user_session(response, user)
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
            response.headers.setdefault("Referrer-Policy", "same-origin")
            response.headers.setdefault("X-Frame-Options", "DENY")
            return response
        finally:
            store.reset_current_user(tenant_token)

    @app.get("/api/health")
    async def health(response: Response) -> dict[str, str | bool]:
        healthy = store.healthy()
        if not healthy:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "ok" if healthy else "degraded",
            "service": "play.xedoc.ru",
            "mode": "multi-user",
            "storage": "ok" if healthy else "error",
            "yandexConfigured": True,
        }

    @app.post("/api/account/register", response_model=AppUserDTO)
    async def register_account(
        body: AccountRegisterRequest,
        request: Request,
        response: Response,
    ) -> AppUserDTO:
        if not settings.registration_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Регистрация временно закрыта")
        await enforce_rate_limit(request, "account-register", maximum=5, window_seconds=900)
        try:
            user = store.create_user(body.username, body.display_name, hash_password(body.password))
        except CredentialStoreError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Такое имя пользователя уже занято") from exc
        issue_user_session(response, user)
        return app_user_dto(user)

    @app.post("/api/account/login", response_model=AppUserDTO)
    async def login_account(
        body: AccountLoginRequest,
        request: Request,
        response: Response,
    ) -> AppUserDTO:
        await enforce_rate_limit(request, "account-login", maximum=10, window_seconds=900)
        user = store.user_by_username(body.username)
        if user is None or not verify_password(body.password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверное имя пользователя или пароль")
        issue_user_session(response, user)
        return app_user_dto(user)

    @app.post("/api/account/logout", response_model=ActionResponse)
    async def logout_account(request: Request, response: Response) -> ActionResponse:
        raw_session = request.cookies.get(settings.user_cookie_name)
        if raw_session:
            store.delete_app_session(session_token_hash(raw_session))
        clear_cookie(response, settings.user_cookie_name)
        return ActionResponse()

    @app.put("/api/account/password", response_model=ActionResponse)
    async def set_account_password(
        body: AccountPasswordRequest,
        request: Request,
    ) -> ActionResponse:
        user = require_app_user(request)
        if user.password_hash is not None and not verify_password(body.current_password or "", user.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Текущий пароль указан неверно")
        store.set_user_password(user.id, hash_password(body.password))
        return ActionResponse()

    @app.get("/api/bootstrap", response_model=BootstrapPayload, response_model_exclude_none=True)
    async def bootstrap(request: Request) -> BootstrapPayload:
        app_user = optional_app_user(request)
        if app_user is None:
            payload = demo_bootstrap(access_locked=True)
            payload.authenticated = False
            return payload

        credential = optional_credential(request)
        if credential is None:
            payload = demo_bootstrap()
            payload.authenticated = True
            payload.app_user = app_user_dto(app_user)
            _attach_xedoc_library(payload, store)
            return payload
        try:
            payload = await gateway.bootstrap(credential)
            payload.access_locked = False
            payload.authenticated = True
            payload.app_user = app_user_dto(app_user)
            _attach_xedoc_library(payload, store)
            return payload
        except GatewayUnauthorized:
            store.delete()
            payload = demo_bootstrap()
            payload.authenticated = True
            payload.app_user = app_user_dto(app_user)
            _attach_xedoc_library(payload, store)
            return payload
        except GatewayError as exc:
            if not settings.demo_fallback:
                raise _http_gateway_error(exc) from exc
            payload = demo_bootstrap()
            payload.connected = True
            payload.demo = True
            payload.user = UserProfileDTO(name=credential.user_name, avatar_url=credential.avatar_url)
            payload.authenticated = True
            payload.app_user = app_user_dto(app_user)
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
        require_app_user(request)
        return PlaylistDTO.model_validate(store.create_local_playlist(body.title, body.description, body.is_public))

    @app.patch("/api/local-playlists/{playlist_id}", response_model=PlaylistDTO, response_model_exclude_none=True)
    async def update_local_playlist(
        playlist_id: str,
        body: LocalPlaylistUpdateRequest,
        request: Request,
        _: None = Depends(require_access),
    ) -> PlaylistDTO:
        require_app_user(request)
        identifier = _safe_local_playlist_id(playlist_id)
        playlist = store.update_local_playlist(
            identifier,
            title=body.title,
            description=body.description,
            is_public=body.is_public,
        )
        return _require_local_playlist(playlist)

    @app.delete("/api/local-playlists/{playlist_id}", response_model=ActionResponse)
    async def delete_local_playlist(
        playlist_id: str,
        request: Request,
        _: None = Depends(require_access),
    ) -> ActionResponse:
        require_app_user(request)
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
        require_app_user(request)
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
        require_app_user(request)
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
        require_app_user(request)
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

    @app.put("/api/presence/now-playing", response_model=ActionResponse)
    async def update_now_playing(
        body: NowPlayingRequest,
        request: Request,
        _: None = Depends(require_access),
    ) -> ActionResponse:
        require_app_user(request)
        track = _sanitize_shared_track(body.track)
        if track.id.startswith("demo-"):
            store.clear_now_playing()
            return ActionResponse()
        playlist_id = _safe_local_playlist_id(body.playlist_id) if body.playlist_id else None
        store.save_now_playing(
            _safe_identifier(track.id),
            track.model_dump(mode="json", by_alias=True, exclude_none=True),
            playlist_id,
        )
        return ActionResponse()

    @app.delete("/api/presence/now-playing", response_model=ActionResponse)
    async def clear_now_playing(
        request: Request,
        _: None = Depends(require_access),
    ) -> ActionResponse:
        require_app_user(request)
        store.clear_now_playing()
        return ActionResponse()

    @app.post("/api/import/vk", response_model=VKImportResult, response_model_exclude_none=True)
    async def import_vk_collection(
        body: VKImportRequest,
        request: Request,
        _: None = Depends(require_access),
    ) -> VKImportResult:
        credential = optional_credential(request)
        semaphore = asyncio.Semaphore(4)
        source_url = _canonical_vk_url(body.source_url)
        results = await asyncio.gather(
            *(match_vk_track(credential, track, semaphore) for track in body.tracks)
        )
        matched_tracks: dict[str, TrackDTO] = {}
        unmatched: list[ExternalTrackDTO] = []
        known_keys = existing_vk_seed_keys()
        for external, track in results:
            save_vk_seed(external, track, known_keys)
            if track:
                matched_tracks.setdefault(track.id, track)
            else:
                unmatched.append(external)

        playlist_id = ensure_vk_playlist(source_url, len(body.tracks))
        for track in matched_tracks.values():
            store.add_local_playlist_track(
                playlist_id,
                track.id,
                track.model_copy(update={"stream_url": None}).model_dump(
                    mode="json", by_alias=True, exclude_none=True
                ),
            )
        store.update_local_playlist(
            playlist_id,
            description=(
                f"Импортировано из {source_url}\n"
                f"Совпало с каталогом Яндекс Музыки: {len(matched_tracks)} из {len(body.tracks)}. "
                "Список также используется как сигнал для рекомендаций XEDOC."
            ),
        )
        playlist = _require_local_playlist(store.load_local_playlist(playlist_id))
        return VKImportResult(playlist=playlist, matched=len(matched_tracks), unmatched=unmatched)

    @app.post("/api/import/vk/jobs", response_model=VKImportJobDTO)
    async def create_vk_import_job(
        body: VKImportRequest,
        request: Request,
        _: None = Depends(require_access),
    ) -> VKImportJobDTO:
        app_user = require_app_user(request)
        await enforce_rate_limit(request, f"vk-import-job:{app_user.id}", maximum=5, window_seconds=3600)
        source_url = _canonical_vk_url(body.source_url)
        unique: dict[tuple[str, str], ExternalTrackDTO] = {}
        for track in body.tracks:
            key = (_normalize_music_text(track.artist), _normalize_music_text(track.title))
            unique.setdefault(key, track)
        tracks = list(unique.values())[:10000]
        previous = store.largest_completed_vk_import_job(source_url)
        carried_processed = 0
        carried_matched = 0
        carried_unmatched = 0
        if previous and previous["status"] == "complete" and previous["source_url"] == source_url:
            previous_tracks = [ExternalTrackDTO.model_validate(item) for item in previous["tracks"]]
            previous_keys = [
                (_normalize_music_text(track.artist), _normalize_music_text(track.title))
                for track in previous_tracks
            ]
            current_keys = [
                (_normalize_music_text(track.artist), _normalize_music_text(track.title))
                for track in tracks[:len(previous_keys)]
            ]
            if previous_keys and previous_keys == current_keys:
                carried_processed = len(previous_keys)
                carried_matched = int(previous["matched"])
                carried_unmatched = int(previous["unmatched"])
        job = store.create_vk_import_job(
            app_user.id,
            source_url,
            [track.model_dump(mode="json", by_alias=True, exclude_none=True) for track in tracks],
        )
        if carried_processed:
            store.update_vk_import_job(
                str(job["id"]),
                processed=carried_processed,
                matched=carried_matched,
                unmatched=carried_unmatched,
            )
            job = store.load_vk_import_job(str(job["id"]), user_id=app_user.id) or job
        schedule_vk_import_job(str(job["id"]), app_user.id)
        return VKImportJobDTO.model_validate(job)

    @app.get("/api/import/vk/jobs/latest", response_model=VKImportJobDTO | None)
    async def latest_vk_import_job(_: None = Depends(require_access)) -> VKImportJobDTO | None:
        job = store.latest_vk_import_job()
        return VKImportJobDTO.model_validate(job) if job else None

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
            owner_id=require_app_user(request).id,
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
        request: Request,
        response: Response,
        _: None = Depends(require_access),
    ) -> DeviceAuthPollDTO:
        app_user = require_app_user(request)
        now = time.monotonic()
        async with attempts_lock:
            pending = attempts.get(body.device_id)
            if pending is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Код подключения не найден")
            if pending.owner_id != app_user.id:
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
                detail="Этот аккаунт XEDOC уже подключён к другому Яндекс-аккаунту",
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
    async def logout(request: Request, response: Response, _: None = Depends(require_access)) -> ActionResponse:
        app_user = require_app_user(request)
        store.delete()
        async with attempts_lock:
            for attempt_id in [key for key, value in attempts.items() if value.owner_id == app_user.id]:
                attempts.pop(attempt_id, None)
        clear_cookie(response, settings.session_cookie_name)
        return ActionResponse()

    @app.get("/api/search", response_model=SearchPayload, response_model_exclude_none=True)
    async def search(
        request: Request,
        q: str = Query(min_length=1, max_length=200),
    ) -> SearchPayload:
        await enforce_rate_limit(request, "music-search", maximum=90, window_seconds=60)
        query = q.strip()
        if not query:
            return SearchPayload()
        profile_query = query.removeprefix("@").strip()
        profiles = [ProfileSearchItemDTO.model_validate(item) for item in store.search_users(profile_query)]
        music_query = profile_query if query.startswith("@") else query
        public_search = optional_app_user(request) is None
        try:
            credential = store.load_catalog_credential() if public_search else optional_credential(request)
        except CredentialStoreError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Каталог временно недоступен") from exc
        if credential is None:
            result = demo_search(music_query)
            result.profiles = profiles
            return result
        try:
            result = await gateway.search(credential, music_query)
            if public_search:
                result.tracks = [
                    track.model_copy(update={
                        "liked": None,
                        "play_count": None,
                        "total_listened_ms": None,
                        "last_played_at": None,
                        "stream_url": (
                            f"/api/public-search/tracks/{quote(track.id, safe='')}/stream"
                            f"?ticket={quote(signer.issue(f'public-search:{track.id}', 600), safe='')}"
                        ),
                    })
                    for track in result.tracks
                ]
                result.playlists = []
            else:
                _decorate_tracks_with_stats(result.tracks, store)
            result.profiles = profiles
            return result
        except GatewayUnauthorized as exc:
            if not public_search:
                store.delete()
            if settings.demo_fallback:
                result = demo_search(music_query)
                result.profiles = profiles
                return result
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Каталог временно недоступен") from exc
        except GatewayError as exc:
            if settings.demo_fallback:
                result = demo_search(music_query)
                result.profiles = profiles
                return result
            raise _http_gateway_error(exc) from exc

    @app.get("/api/public-search/tracks/{track_id}/stream", response_class=RedirectResponse)
    async def public_search_stream(
        track_id: str,
        request: Request,
        ticket: str = Query(min_length=20, max_length=500),
    ) -> RedirectResponse:
        await enforce_rate_limit(request, "public-search-stream", maximum=240, window_seconds=60)
        track_identifier = _safe_identifier(track_id)
        if not signer.verify(ticket, f"public-search:{track_identifier}"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ссылка на трек истекла")
        try:
            credential = store.load_catalog_credential()
        except CredentialStoreError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Каталог временно недоступен") from exc
        if credential is None:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Каталог временно недоступен")
        try:
            url = await gateway.stream_url(credential, track_identifier)
        except GatewayError as exc:
            raise _http_gateway_error(exc) from exc
        return RedirectResponse(
            url=url,
            status_code=status.HTTP_307_TEMPORARY_REDIRECT,
            headers={"Cache-Control": "public, no-store, max-age=0", "Referrer-Policy": "no-referrer"},
        )

    @app.get("/api/profiles/search", response_model=list[ProfileSearchItemDTO])
    async def search_public_profiles(
        request: Request,
        q: str = Query(min_length=1, max_length=80),
    ) -> list[ProfileSearchItemDTO]:
        await enforce_rate_limit(request, "profile-search", maximum=120, window_seconds=60)
        query = q.strip()
        if not query:
            return []
        return [ProfileSearchItemDTO.model_validate(item) for item in store.search_users(query)]

    @app.get("/api/social/feed", response_model=SocialFeedDTO, response_model_exclude_none=True)
    async def social_feed(
        request: Request,
        mode: str = Query(default="for-you", pattern=r"^(for-you|friends)$"),
        limit: int = Query(default=50, ge=1, le=100),
        _: None = Depends(require_access),
    ) -> SocialFeedDTO:
        require_app_user(request)
        return SocialFeedDTO(posts=[SocialPostDTO.model_validate(item) for item in store.social_feed(mode, limit)])

    @app.get("/api/social/friends", response_model=FriendsPayload)
    async def social_friends(_: None = Depends(require_access)) -> FriendsPayload:
        return FriendsPayload.model_validate(store.list_friends())

    @app.get("/api/social/friends/{username}/status", response_model=FriendStatusDTO)
    async def social_friend_status(username: str, _: None = Depends(require_access)) -> FriendStatusDTO:
        try:
            return FriendStatusDTO(status=store.friend_status(_safe_username(username)))
        except CredentialStoreError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @app.post("/api/social/friends/{username}/request", response_model=FriendStatusDTO)
    async def social_friend_request(username: str, _: None = Depends(require_access)) -> FriendStatusDTO:
        try:
            return FriendStatusDTO(status=store.request_friend(_safe_username(username)))
        except CredentialStoreError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/api/social/friends/{username}/accept", response_model=FriendStatusDTO)
    async def social_friend_accept(username: str, _: None = Depends(require_access)) -> FriendStatusDTO:
        try:
            return FriendStatusDTO(status=store.accept_friend(_safe_username(username)))
        except CredentialStoreError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.delete("/api/social/friends/{username}", response_model=ActionResponse)
    async def social_friend_remove(username: str, _: None = Depends(require_access)) -> ActionResponse:
        store.remove_friend(_safe_username(username))
        return ActionResponse()

    @app.post("/api/social/posts", response_model=SocialPostDTO, response_model_exclude_none=True)
    async def create_social_post(
        body: SocialPostCreateRequest,
        request: Request,
        _: None = Depends(require_access),
    ) -> SocialPostDTO:
        require_app_user(request)
        if not body.body.strip() and not body.attachments and body.poll is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Добавьте текст или вложение")
        attachments = [_sanitize_social_attachment(item.model_dump(by_alias=True, exclude_none=True)) for item in body.attachments]
        poll = body.poll.model_dump(by_alias=True) if body.poll else None
        return SocialPostDTO.model_validate(
            store.create_social_post(body.body, body.visibility, attachments, poll)
        )

    @app.get(
        "/api/social/profiles/{username}/posts",
        response_model=list[SocialPostDTO],
        response_model_exclude_none=True,
    )
    async def social_profile_posts(
        username: str,
        request: Request,
        limit: int = Query(default=40, ge=1, le=100),
    ) -> list[SocialPostDTO]:
        await enforce_rate_limit(request, "social-profile-posts", maximum=120, window_seconds=60)
        try:
            return [
                SocialPostDTO.model_validate(item)
                for item in store.list_profile_posts(_safe_username(username), limit)
            ]
        except CredentialStoreError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @app.delete("/api/social/posts/{post_id}", response_model=ActionResponse)
    async def delete_social_post(post_id: str, _: None = Depends(require_access)) -> ActionResponse:
        if not store.delete_social_post(_safe_social_id(post_id)):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
        return ActionResponse()

    @app.put("/api/social/posts/{post_id}/like", response_model=SocialPostDTO, response_model_exclude_none=True)
    async def like_social_post(post_id: str, _: None = Depends(require_access)) -> SocialPostDTO:
        post = store.set_social_post_like(_safe_social_id(post_id), True)
        if post is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
        return SocialPostDTO.model_validate(post)

    @app.delete("/api/social/posts/{post_id}/like", response_model=SocialPostDTO, response_model_exclude_none=True)
    async def unlike_social_post(post_id: str, _: None = Depends(require_access)) -> SocialPostDTO:
        post = store.set_social_post_like(_safe_social_id(post_id), False)
        if post is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
        return SocialPostDTO.model_validate(post)

    @app.post("/api/social/posts/{post_id}/vote", response_model=SocialPostDTO, response_model_exclude_none=True)
    async def vote_social_post(
        post_id: str,
        body: PollVoteRequest,
        _: None = Depends(require_access),
    ) -> SocialPostDTO:
        post = store.vote_social_poll(_safe_social_id(post_id), _safe_social_id(body.option_id))
        if post is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Опрос или вариант не найден")
        return SocialPostDTO.model_validate(post)

    @app.get("/api/admin/dashboard", response_model=AdminDashboardDTO, response_model_exclude_none=True)
    async def admin_dashboard(
        request: Request,
        q: str = Query(default="", max_length=80),
        limit: int = Query(default=100, ge=1, le=250),
    ) -> AdminDashboardDTO:
        require_admin(request)
        await enforce_rate_limit(request, "admin-dashboard", maximum=120, window_seconds=60)
        return AdminDashboardDTO.model_validate(store.admin_dashboard(q, limit))

    @app.get("/api/profiles/{username}", response_model=PublicProfileDTO, response_model_exclude_none=True)
    async def public_profile(username: str, request: Request) -> PublicProfileDTO:
        await enforce_rate_limit(request, "public-profile", maximum=120, window_seconds=60)
        profile = store.load_public_profile(_safe_username(username))
        if profile is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Профиль не найден")
        safe_username = _safe_username(username)
        _decorate_public_top_tracks(profile, safe_username)
        _decorate_public_now_playing(profile, safe_username)
        return PublicProfileDTO.model_validate(profile)

    @app.get(
        "/api/profiles/{username}/top-tracks/{track_id}/stream",
        response_class=RedirectResponse,
    )
    async def public_profile_top_track_stream(username: str, track_id: str, request: Request) -> RedirectResponse:
        await enforce_rate_limit(request, "public-profile-top-stream", maximum=240, window_seconds=60)
        safe_username = _safe_username(username)
        track_identifier = _safe_identifier(track_id)
        loaded = store.load_public_top_track(safe_username, track_identifier)
        if loaded is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Трек не опубликован в профиле")
        _track, owner_id = loaded
        try:
            credential = store.load_for_user(owner_id)
        except CredentialStoreError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Музыка временно недоступна") from exc
        if credential is None:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="Владелец отключил музыкальную коллекцию")
        try:
            url = await gateway.stream_url(credential, track_identifier)
        except GatewayError as exc:
            raise _http_gateway_error(exc) from exc
        return RedirectResponse(
            url=url,
            status_code=status.HTTP_307_TEMPORARY_REDIRECT,
            headers={"Cache-Control": "public, no-store, max-age=0", "Referrer-Policy": "no-referrer"},
        )

    @app.get(
        "/api/profiles/{username}/now-playing",
        response_model=PublicNowPlayingDTO | None,
        response_model_exclude_none=True,
    )
    async def public_now_playing(username: str, request: Request) -> PublicNowPlayingDTO | None:
        await enforce_rate_limit(request, "public-now-playing", maximum=180, window_seconds=60)
        safe_username = _safe_username(username)
        loaded = store.load_public_now_playing(safe_username)
        if loaded is None:
            return None
        value, _owner_id = loaded
        _decorate_public_now_playing({"nowPlaying": value}, safe_username)
        return PublicNowPlayingDTO.model_validate(value)

    @app.get(
        "/api/profiles/{username}/now-playing/tracks/{track_id}/stream",
        response_class=RedirectResponse,
    )
    async def public_now_playing_stream(username: str, track_id: str, request: Request) -> RedirectResponse:
        await enforce_rate_limit(request, "public-now-playing-stream", maximum=240, window_seconds=60)
        safe_username = _safe_username(username)
        track_identifier = _safe_identifier(track_id)
        loaded = store.load_public_now_playing(safe_username)
        if loaded is None or str(loaded[0].get("track", {}).get("id", "")) != track_identifier:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Трек уже не играет")
        _value, owner_id = loaded
        try:
            credential = store.load_for_user(owner_id)
        except CredentialStoreError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Музыка временно недоступна") from exc
        if credential is None:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="Владелец отключил музыкальную коллекцию")
        try:
            url = await gateway.stream_url(credential, track_identifier)
        except GatewayError as exc:
            raise _http_gateway_error(exc) from exc
        return RedirectResponse(
            url=url,
            status_code=status.HTTP_307_TEMPORARY_REDIRECT,
            headers={"Cache-Control": "public, no-store, max-age=0", "Referrer-Policy": "no-referrer"},
        )

    @app.get(
        "/api/profiles/{username}/playlists/{playlist_id}",
        response_model=PlaylistDTO,
        response_model_exclude_none=True,
    )
    async def public_profile_playlist(username: str, playlist_id: str, request: Request) -> PlaylistDTO:
        await enforce_rate_limit(request, "public-profile-playlist", maximum=120, window_seconds=60)
        safe_username = _safe_username(username)
        identifier = _safe_local_playlist_id(playlist_id)
        loaded = store.load_public_playlist(safe_username, identifier)
        if loaded is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публичный плейлист не найден")
        playlist, _owner_id = loaded
        dto = PlaylistDTO.model_validate(playlist)
        dto.tracks = [
            track.model_copy(update={"stream_url": _public_profile_stream_path(safe_username, identifier, track.id)})
            for track in (dto.tracks or [])
        ]
        return dto

    @app.get(
        "/api/profiles/{username}/playlists/{playlist_id}/tracks/{track_id}/stream",
        response_class=RedirectResponse,
    )
    async def public_profile_playlist_stream(
        username: str,
        playlist_id: str,
        track_id: str,
        request: Request,
    ) -> RedirectResponse:
        await enforce_rate_limit(request, "public-profile-stream", maximum=240, window_seconds=60)
        safe_username = _safe_username(username)
        identifier = _safe_local_playlist_id(playlist_id)
        track_identifier = _safe_identifier(track_id)
        loaded = store.load_public_playlist(safe_username, identifier)
        if loaded is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публичный плейлист не найден")
        playlist, owner_id = loaded
        if track_identifier not in {str(track.get("id", "")) for track in playlist.get("tracks", [])}:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Трек не входит в публичный плейлист")
        try:
            credential = store.load_for_user(owner_id)
        except CredentialStoreError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Музыка временно недоступна") from exc
        if credential is None:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="Владелец отключил музыкальную коллекцию")
        try:
            url = await gateway.stream_url(credential, track_identifier)
        except GatewayError as exc:
            raise _http_gateway_error(exc) from exc
        return RedirectResponse(
            url=url,
            status_code=status.HTTP_307_TEMPORARY_REDIRECT,
            headers={"Cache-Control": "public, no-store, max-age=0", "Referrer-Policy": "no-referrer"},
        )

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
            credential = store.load_for_user(share.owner_id)
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


def _safe_username(value: str) -> str:
    username = value.strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,32}", username):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Профиль не найден")
    return username


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


def _safe_social_id(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректный идентификатор")
    return value


def _sanitize_social_attachment(value: dict) -> dict:
    kind = str(value.get("kind", ""))
    if kind not in {"image", "video", "link", "track", "playlist"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестный тип вложения")
    for field in ("url", "imageUrl"):
        raw = value.get(field)
        if not raw:
            continue
        candidate = str(raw).strip()
        parsed = urlparse(candidate)
        is_small_image = kind == "image" and candidate.startswith("data:image/") and len(candidate) <= 2_000_000
        if not is_small_image and (parsed.scheme not in {"http", "https"} or not parsed.netloc or len(candidate) > 2_000):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректная ссылка во вложении")
        value[field] = candidate
    if kind in {"image", "video", "link"} and not value.get("url"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Для вложения нужна ссылка или файл")
    if kind == "track" and not isinstance(value.get("track"), dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Выберите трек")
    if kind == "playlist" and not isinstance(value.get("playlist"), dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Выберите плейлист")
    if isinstance(value.get("track"), dict):
        value["track"].pop("liked", None)
        track_id = _safe_identifier(str(value["track"].get("id", "")))
        value["track"]["streamUrl"] = f"/api/tracks/{quote(track_id, safe='')}/stream"
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
        if not track_id.startswith("vk-seed-"):
            known_track_ids.add(track_id)
        if event.get("source") == "player" and track_id not in recent_player_ids:
            recent_player_ids.append(track_id)
        elif not track_id.startswith("vk-seed-") and track_id not in fallback_signal_ids:
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


def _canonical_vk_url(value: str) -> str:
    parsed = urlparse(value.strip())
    hostname = (parsed.hostname or "").casefold()
    match = re.fullmatch(r"/audios(-?\d+)", parsed.path.rstrip("/"))
    if parsed.scheme != "https" or hostname not in {"vk.ru", "www.vk.ru", "vk.com", "www.vk.com"} or not match:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нужна ссылка вида https://vk.ru/audios145429079",
        )
    return f"https://vk.ru/audios{match.group(1)}"


def _load_public_share(store: CredentialStore, token: str):
    share = store.load_public_share(_safe_share_token(token))
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Публичная ссылка не найдена")
    return share


def _public_stream_path(token: str, track_id: str) -> str:
    return f"/api/shares/{quote(token, safe='')}/tracks/{quote(track_id, safe='')}/stream"


def _public_profile_stream_path(username: str, playlist_id: str, track_id: str) -> str:
    return (
        f"/api/profiles/{quote(username, safe='')}/playlists/{quote(playlist_id, safe='')}"
        f"/tracks/{quote(track_id, safe='')}/stream"
    )


def _public_now_playing_stream_path(username: str, track_id: str) -> str:
    return f"/api/profiles/{quote(username, safe='')}/now-playing/tracks/{quote(track_id, safe='')}/stream"


def _public_profile_top_stream_path(username: str, track_id: str) -> str:
    return f"/api/profiles/{quote(username, safe='')}/top-tracks/{quote(track_id, safe='')}/stream"


def _decorate_public_top_tracks(profile: dict, username: str) -> None:
    tracks = profile.get("topTracks")
    if not isinstance(tracks, list):
        return
    for track in tracks:
        if not isinstance(track, dict):
            continue
        track_id = str(track.get("id", ""))
        if track_id:
            track["streamUrl"] = _public_profile_top_stream_path(username, track_id)


def _decorate_public_now_playing(profile: dict, username: str) -> None:
    value = profile.get("nowPlaying")
    if not isinstance(value, dict) or not isinstance(value.get("track"), dict):
        return
    track = value["track"]
    track_id = str(track.get("id", ""))
    if track_id:
        track["streamUrl"] = _public_now_playing_stream_path(username, track_id)


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
