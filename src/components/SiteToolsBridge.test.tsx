import { cleanup, render, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListeningStats, Playlist, SearchPayload, Track } from '../types'
import { SiteToolsBridge, type WebMcpTool } from './SiteToolsBridge'

const api = vi.hoisted(() => ({
  addTrackToLocalPlaylist: vi.fn(),
  buildSession: vi.fn(),
  getBootstrap: vi.fn(),
  getListeningStats: vi.fn(),
  getLocalPlaylists: vi.fn(),
  searchMusic: vi.fn(),
}))

const player = vi.hoisted(() => ({
  current: undefined as Track | undefined,
  currentIndex: -1,
  queue: [] as Track[],
  history: [] as Track[],
  historyEntries: [] as Array<{ track: Track; playedAt: number }>,
  isPlaying: false,
  progress: 0,
  duration: 0,
  volume: 0.8,
  shuffle: false,
  repeat: false,
  playTrack: vi.fn(),
  playQueue: vi.fn(),
  addNext: vi.fn(),
}))

vi.mock('../lib/api', () => api)
vi.mock('../player/PlayerContext', () => ({ usePlayer: () => player }))

const firstTrack: Track = { id: 'track-1', title: 'Первый', artists: ['Артист'], durationMs: 180_000 }
const secondTrack: Track = { id: 'track-2', title: 'Второй', artists: ['Другой артист'], durationMs: 210_000 }
const localPlaylist: Playlist = { id: 'local-1', title: 'Для работы', trackCount: 2, local: true, isPublic: false }
const remotePlaylist: Playlist = { id: 'remote-1', title: 'Из Яндекса', trackCount: 20 }

describe('XEDOC Play WebMCP site tools', () => {
  const registered = new Map<string, WebMcpTool>()
  const registerTool = vi.fn(async (tool: WebMcpTool) => { registered.set(tool.name, tool) })

  beforeEach(() => {
    registered.clear()
    registerTool.mockClear()
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: { registerTool },
    })

    player.current = firstTrack
    player.currentIndex = 0
    player.queue = [firstTrack]
    player.history = [firstTrack]
    player.historyEntries = []
    player.isPlaying = true
    player.progress = 12
    player.duration = 180
    player.volume = 0.8
    player.shuffle = false
    player.repeat = false
    player.playTrack.mockReset()
    player.playQueue.mockReset()
    player.addNext.mockReset()

    const search: SearchPayload = { tracks: [firstTrack, secondTrack], playlists: [remotePlaylist], profiles: [] }
    const listeningStats: ListeningStats = {
      totalPlays: 8,
      uniqueTracks: 2,
      totalListenedMs: 1_200_000,
      top: [{ id: 'all-time', title: 'За всё время', totalPlays: 8, tracks: [secondTrack] }],
    }
    api.searchMusic.mockReset().mockResolvedValue(search)
    api.buildSession.mockReset().mockResolvedValue({ tracks: [secondTrack, firstTrack] })
    api.getBootstrap.mockReset().mockResolvedValue({ authenticated: true, playlists: [remotePlaylist], localPlaylists: [localPlaylist] })
    api.getLocalPlaylists.mockReset().mockResolvedValue([localPlaylist])
    api.addTrackToLocalPlaylist.mockReset().mockResolvedValue({ ...localPlaylist, trackCount: 3, tracks: [firstTrack] })
    api.getListeningStats.mockReset().mockResolvedValue(listeningStats)
  })

  afterEach(() => {
    cleanup()
    delete (document as Document & { modelContext?: unknown }).modelContext
  })

  async function renderTools() {
    render(<StrictMode><SiteToolsBridge /></StrictMode>)
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(9))
  }

  it('registers the complete read and write tool set', async () => {
    await renderTools()

    expect([...registered.keys()]).toEqual([
      'search_music',
      'get_player_state',
      'get_queue',
      'play_track',
      'add_next',
      'build_session',
      'list_playlists',
      'add_to_playlist',
      'get_listening_stats',
    ])
    expect(registered.get('search_music')?.annotations?.readOnlyHint).toBe(true)
    expect(registered.get('get_queue')?.annotations?.readOnlyHint).toBe(true)
    expect(registered.get('play_track')?.annotations?.readOnlyHint).toBe(false)
    expect(registered.get('add_to_playlist')?.annotations?.readOnlyHint).toBe(false)
  })

  it('connects search results to playback, queue, sessions and playlists', async () => {
    await renderTools()

    const searchResult = await registered.get('search_music')!.execute({ query: 'Артист', limit: 2 }) as { tracks: Array<{ id: string }> }
    expect(searchResult.tracks.map((track) => track.id)).toEqual(['track-1', 'track-2'])
    expect(api.searchMusic).toHaveBeenCalledWith('Артист')

    await registered.get('play_track')!.execute({ trackId: 'track-2' })
    expect(player.playTrack).toHaveBeenCalledWith(secondTrack, [firstTrack, secondTrack], 1)

    await registered.get('add_next')!.execute({ trackId: 'track-2' })
    expect(player.addNext).toHaveBeenCalledWith(secondTrack)

    const sessionResult = await registered.get('build_session')!.execute({ duration: 25, discovery: 75, cooldownDays: 7, source: 'all' }) as { status: string; trackCount: number }
    expect(api.buildSession).toHaveBeenCalledWith({ duration: 25, discovery: 75, cooldownDays: 7, source: 'all', excludeTrackIds: [] })
    expect(player.playQueue).toHaveBeenCalledWith([secondTrack, firstTrack])
    expect(sessionResult).toMatchObject({ status: 'playback_requested', trackCount: 2 })

    const listResult = await registered.get('list_playlists')!.execute({ kind: 'all' }) as { playlists: Array<{ id: string; editable: boolean }> }
    expect(listResult.playlists).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'local-1', editable: true }),
      expect.objectContaining({ id: 'remote-1', editable: false }),
    ]))

    const playlistResult = await registered.get('add_to_playlist')!.execute({ playlistId: 'local-1', trackId: 'track-2' }) as { status: string }
    expect(api.addTrackToLocalPlaylist).toHaveBeenCalledWith('local-1', secondTrack)
    expect(playlistResult.status).toBe('track_added')
  })

  it('returns verifiable player, queue and listening-stat results', async () => {
    await renderTools()

    const state = await registered.get('get_player_state')!.execute() as { current: { id: string }; isPlaying: boolean; progressSeconds: number }
    expect(state).toMatchObject({ current: { id: 'track-1' }, isPlaying: true, progressSeconds: 12 })

    const queue = await registered.get('get_queue')!.execute({ limit: 10 }) as { totalItems: number; items: Array<{ current: boolean }> }
    expect(queue).toMatchObject({ totalItems: 1, items: [{ current: true }] })

    const stats = await registered.get('get_listening_stats')!.execute({ limit: 5 }) as { scope: string; period: { tracks: Array<{ id: string }> } }
    expect(stats.scope).toBe('personal')
    expect(stats.period.tracks[0].id).toBe('track-2')

    expect(() => registered.get('play_track')!.execute({ trackId: 'missing' })).toThrow('Сначала вызовите search_music')
  })
})
