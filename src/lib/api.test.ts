import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSession, getBootstrap, searchMusic } from './api'

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

  it('does not fabricate a session when the server is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(buildSession({ duration: 25, discovery: 50, cooldownDays: 30, source: 'all' })).rejects.toThrow('offline')
  })
})
