import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSession, createPlaylistShare, createTrackShare, decodeVKImportFragment, getBootstrap, getPublicShare, registerAccount, searchMusic } from './api'

describe('API error handling', () => {
  afterEach(() => vi.restoreAllMocks())

  it('surfaces a bootstrap outage instead of showing unrelated demo data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(getBootstrap()).rejects.toThrow('offline')
  })

  it('surfaces an offline search request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(searchMusic('After')).rejects.toThrow('offline')
  })

  it('requests the dedicated artist catalog when artist search is selected', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tracks: [], playlists: [], profiles: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    await searchMusic('GUNSHIP', true)

    expect(fetchMock).toHaveBeenCalledWith('/api/search?q=GUNSHIP&artist=true', expect.objectContaining({ credentials: 'include' }))
  })

  it('does not fabricate a session when the server is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(buildSession({ duration: 25, discovery: 50, cooldownDays: 30, source: 'all' })).rejects.toThrow('offline')
  })

  it('creates and reads public share links through the dedicated API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'share-token', path: '/share/share-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'playlist-token', path: '/share/playlist-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'share-token', kind: 'track', sharedBy: 'Rodion', createdAt: 1 }) })
    vi.stubGlobal('fetch', fetchMock)

    await createTrackShare({ id: '101', title: 'Signal', artists: ['Artist'], durationMs: 1000 })
    await createPlaylistShare('42:7')
    await getPublicShare('share-token')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/shares/tracks', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/shares/playlists', expect.objectContaining({ body: JSON.stringify({ playlistId: '42:7' }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/shares/share-token', expect.objectContaining({ credentials: 'include' }))
  })

  it('decodes the browser-collected VK list from an uncompressed URL fragment', async () => {
    const payload = JSON.stringify({ sourceUrl: 'https://vk.ru/audios145429079', tracks: [{ title: 'Signal', artist: 'Artist', duration: '3:21' }] })
    const encoded = window.btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    await expect(decodeVKImportFragment(`#j.${encoded}`)).resolves.toEqual({
      sourceUrl: 'https://vk.ru/audios145429079',
      tracks: [{ title: 'Signal', artist: 'Artist', duration: '3:21' }],
    })
  })

  it('rejects a malformed VK import fragment', async () => {
    await expect(decodeVKImportFragment('#broken')).rejects.toThrow('повреждены')
  })

  it('turns structured validation details into a readable field error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: [{ type: 'string_pattern_mismatch', loc: ['body', 'username'], msg: 'String should match pattern' }] }),
    }))
    await expect(registerAccount('person@example.com', 'Person', 'secure-password')).rejects.toThrow('Email здесь не используется')
  })
})
