"""Download audio resolved by the music gateway, never a user-supplied URL."""
from pathlib import PurePosixPath
import re
from urllib.parse import quote, urlparse

import httpx
from fastapi import HTTPException
from fastapi.responses import StreamingResponse


def safe_filename(name: str) -> str:
    return re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|]', '_', name)[:160].strip(' .') or 'track'


async def download_audio(url: str, name: str) -> StreamingResponse:
    client = httpx.AsyncClient(timeout=httpx.Timeout(60, connect=15), follow_redirects=True)
    try:
        upstream = await client.send(client.build_request('GET', url), stream=True)
        upstream.raise_for_status()
        mime = upstream.headers.get('content-type', '').split(';')[0].lower()
        extensions = {'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/ogg': '.ogg', 'application/ogg': '.ogg', 'audio/flac': '.flac', 'audio/x-flac': '.flac', 'audio/wav': '.wav', 'audio/x-wav': '.wav'}
        suffix = PurePosixPath(urlparse(str(upstream.url)).path).suffix.lower()
        if mime not in extensions and mime != 'application/octet-stream':
            raise HTTPException(status_code=502, detail='Источник не вернул аудиофайл')
        extension = extensions.get(mime, suffix if suffix in extensions.values() else '.mp3')
    except BaseException as exc:
        if 'upstream' in locals():
            await upstream.aclose()
        await client.aclose()
        if isinstance(exc, httpx.HTTPError):
            raise HTTPException(status_code=502, detail='Не удалось получить аудиофайл. Попробуйте ещё раз.') from exc
        raise

    async def chunks():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    headers = {'Content-Disposition': "attachment; filename*=UTF-8''" + quote(safe_filename(name) + extension), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}
    for key in ('content-length', 'content-encoding'):
        if key in upstream.headers:
            headers[key] = upstream.headers[key]
    return StreamingResponse(chunks(), media_type=mime, headers=headers)
