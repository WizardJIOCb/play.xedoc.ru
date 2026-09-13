from urllib.parse import unquote

import httpx
import pytest

from app import downloads
from .conftest import connect, TEST_TRACK
from .test_api import seed_shared_catalog


@pytest.fixture
def upstream(monkeypatch):
    calls = []
    state = {'status': 200, 'mime': 'audio/mpeg', 'body': b'ID3-test-audio'}
    class AudioStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield state['body']
    def handler(request):
        calls.append(request)
        return httpx.Response(state['status'], headers={'content-type': state['mime'], 'content-length': str(len(state['body']))}, stream=AudioStream())
    original = httpx.AsyncClient
    monkeypatch.setattr(downloads.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    return calls, state


def test_download_returns_audio_and_safe_unicode_filename(client, upstream):
    connect(client)
    response = client.get('/api/tracks/101/stream', params={'download': '1', 'filename': 'Артист / Песня\r\n'})
    assert response.status_code == 200
    assert response.content == b'ID3-test-audio'
    assert response.headers['content-type'] == 'audio/mpeg'
    assert unquote(response.headers['content-disposition']) == "attachment; filename*=UTF-8''Артист _ Песня__.mp3"
    assert len(upstream[0]) == 1
    # Ordinary playback still redirects, without proxying the audio.
    assert client.get('/api/tracks/101/stream', follow_redirects=False).status_code == 307
    assert len(upstream[0]) == 1


def test_download_preserves_guest_ticket_and_share_access(client, store, upstream):
    seed_shared_catalog(store)
    payload = client.get('/api/search', params={'q': 'signal'}).json()
    path = payload['tracks'][0]['streamUrl']
    assert client.get(path + '&download=1').status_code == 200
    assert client.get('/api/public-search/tracks/101/stream?ticket=invalid-ticket-value&download=1').status_code == 403
    connect(client)
    share = client.post('/api/shares/tracks', json={'track': TEST_TRACK.model_dump(by_alias=True)}).json()
    client.cookies.clear()
    assert client.get(f"/api/shares/{share['token']}/tracks/101/stream?download=1").content == b'ID3-test-audio'
    assert client.get(f"/api/shares/{share['token']}/tracks/999/stream?download=1").status_code == 404
    assert len(upstream[0]) == 2


@pytest.mark.parametrize('status,mime', [(403, 'audio/mpeg'), (200, 'text/html')])
def test_download_rejects_upstream_errors(client, upstream, status, mime):
    connect(client)
    upstream[1].update(status=status, mime=mime)
    response = client.get('/api/tracks/101/stream?download=1')
    assert response.status_code == 502
    assert 'content-disposition' not in response.headers
