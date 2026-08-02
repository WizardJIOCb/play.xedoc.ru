from __future__ import annotations

import asyncio
import hmac
import secrets
import time
from dataclasses import dataclass
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
    PlaylistDTO,
    SearchPayload,
    SessionPayload,
    SessionPreferences,
    UserProfileDTO,
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
            return payload

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
            return await gateway.search(credential, query)
        except GatewayUnauthorized as exc:
            store.delete()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        except GatewayError as exc:
            if settings.demo_fallback:
                return demo_search(query)
            raise _http_gateway_error(exc) from exc

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
        credential = optional_credential(request)
        if credential is None:
            demo = next((item for item in DEMO_PLAYLISTS if item.id == identifier), None)
            if demo is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Плейлист не найден")
            return demo
        try:
            return await gateway.playlist(credential, identifier)
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
            return await gateway.build_session(credential, preferences)
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
