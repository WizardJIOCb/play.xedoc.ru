import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App, { QuickTrack, filterCollectionTracks, stabilizeTrackOrder } from './App'
import { getBootstrap, getListeningStats, getPublicShare } from './lib/api'
import { PlayerProvider } from './player/PlayerContext'
import type { Track } from './types'

vi.mock('./lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/api')>()
  return {
    ...original,
    getBootstrap: vi.fn().mockResolvedValue({
      connected: false, demo: true, catalogAvailable: false, accessLocked: false, authenticated: true,
      appUser: { id: 'user-listener', username: 'listener', displayName: 'Music Listener', needsPassword: false, isAdmin: false },
      quickTracks: [], playlists: [], recommendations: [], rediscover: [], localPlaylists: [], likedTracks: [], likedCount: 0,
      xedocRecommendations: [], xedocCollections: [],
    }),
    getPublicProfile: vi.fn().mockResolvedValue({
      username: 'listener', displayName: 'Music Listener', memberSince: 1_700_000_000, publicPlaylistCount: 0,
      stats: { totalPlays: 0, uniqueTracks: 0, totalListenedMs: 0 }, topTracks: [], playlists: [],
    }),
    getSocialProfilePosts: vi.fn().mockResolvedValue([]),
    getFriendStatus: vi.fn().mockResolvedValue('self'),
    getListeningStats: vi.fn().mockResolvedValue({
      totalPlays: 3, uniqueTracks: 1, totalListenedMs: 60_000,
      top: [{ id: 'day', title: 'За день', periodDays: 1, totalPlays: 3, tracks: [{ id: 'popular', title: 'Popular', artists: ['Artist'], durationMs: 180_000, playCount: 3, streamUrl: '/api/public-search/tracks/popular/stream?ticket=signed-ticket' }] }],
    }),
    getPublicShare: vi.fn().mockResolvedValue({
      token: 'public-share-token-123456', kind: 'track', sharedBy: 'Rodion', createdAt: 1_700_000_000,
      track: { id: 'shared', title: 'Shared signal', artists: ['Artist'], durationMs: 300_000, streamUrl: '/api/shares/public-share-token-123456/tracks/shared/stream' },
    }),
  }
})

const liked: Track = { id: 'liked', title: 'Liked', artists: ['Artist'], durationMs: 180_000, liked: true }
const removed: Track = { id: 'removed', title: 'Removed', artists: ['Artist'], durationMs: 180_000, liked: false }

describe('favorite collection filtering', () => {
  afterEach(() => {
    cleanup()
    window.history.replaceState(null, '', '/')
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('removes unliked tracks from favorites but preserves complete history', () => {
    expect(filterCollectionTracks('liked', [liked, removed], (track) => Boolean(track.liked))).toEqual([liked])
    expect(filterCollectionTracks('history', [liked, removed], () => false)).toEqual([liked, removed])
  })

  it('keeps history rows stable while tracks receive newer timestamps', () => {
    const initial = stabilizeTrackOrder([], [liked, removed])
    const updated = stabilizeTrackOrder(initial.order, [removed, liked])

    expect(updated.tracks.map((track) => track.id)).toEqual(['liked', 'removed'])
  })

  it('turns the active quick track play icon into a pause control', () => {
    const audio = document.createElement('audio')
    Object.defineProperty(audio, 'play', { value: vi.fn().mockResolvedValue(undefined) })
    Object.defineProperty(audio, 'pause', { value: vi.fn() })
    Object.defineProperty(audio, 'load', { value: vi.fn() })
    vi.stubGlobal('Audio', vi.fn(function AudioMock() { return audio }))
    const track: Track = { id: 'sunrise', title: 'Sunrise', artists: ['Qafeep'], durationMs: 173_000, streamUrl: '/api/public-search/tracks/sunrise/stream' }

    render(createElement(PlayerProvider, null, createElement(QuickTrack, { track, context: [track] })))
    fireEvent.click(screen.getByRole('button', { name: 'Включить Sunrise' }))

    const pauseButton = screen.getByRole('button', { name: 'Пауза Sunrise' })
    expect(pauseButton.querySelector('.lucide-pause')).toBeInTheDocument()
    fireEvent.click(pauseButton)
    expect(screen.getByRole('button', { name: 'Включить Sunrise' }).querySelector('.lucide-play')).toBeInTheDocument()
  })

  it('shows actual session controls instead of a fixed discovery claim', async () => {
    render(createElement(PlayerProvider, null, createElement(App)))

    expect(await screen.findByRole('heading', { name: /Сессия под ваши правила/ })).toBeInTheDocument()
    expect(screen.getByText('Настройте — и слушайте.')).toBeInTheDocument()
    expect(screen.getByText('25 · 50 · 90 минут')).toBeInTheDocument()
    expect(screen.getByText('Каталог XEDOC')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Настроить сессию' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Включить подборку' })).toBeDisabled()
    expect(screen.queryByText('58%')).not.toBeInTheDocument()
  })

  it('lets a guest open the home catalog and requests authentication for protected sections', async () => {
    vi.mocked(getBootstrap).mockResolvedValueOnce({
      connected: false, demo: false, catalogAvailable: true, accessLocked: false, authenticated: false,
      quickTracks: [{ id: 'popular', title: 'Popular', artists: ['Artist'], durationMs: 180_000, streamUrl: '/api/public-search/tracks/popular/stream?ticket=signed-ticket' }],
      playlists: [], recommendations: [], rediscover: [], localPlaylists: [], likedTracks: [], likedCount: 0,
      xedocRecommendations: [], xedocCollections: [],
    })

    render(createElement(PlayerProvider, null, createElement(App)))

    expect(await screen.findByRole('heading', { name: /Музыка играет сразу/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Включить популярное' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Лента' })[0])
    expect(await screen.findByRole('dialog', { name: 'Вход или регистрация' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Войдите в XEDOC.' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
  })

  it('opens playlist creation from the sidebar and protects it for guests', async () => {
    render(createElement(PlayerProvider, null, createElement(App)))
    fireEvent.click(await screen.findByRole('button', { name: 'Новый плейлист' }))
    expect(await screen.findByRole('dialog', { name: 'Новый плейлист' })).toBeInTheDocument()
    cleanup()

    vi.mocked(getBootstrap).mockResolvedValueOnce({
      connected: false, demo: false, catalogAvailable: true, accessLocked: false, authenticated: false,
      quickTracks: [], playlists: [], recommendations: [], rediscover: [], localPlaylists: [], likedTracks: [], likedCount: 0,
      xedocRecommendations: [], xedocCollections: [],
    })
    render(createElement(PlayerProvider, null, createElement(App)))
    fireEvent.click(await screen.findByRole('button', { name: 'Новый плейлист' }))
    expect(await screen.findByRole('dialog', { name: 'Вход или регистрация' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Новый плейлист' })).not.toBeInTheDocument()
  })

  it('lets a guest open and play the public top without an auth prompt', async () => {
    vi.mocked(getBootstrap).mockResolvedValueOnce({
      connected: false, demo: false, catalogAvailable: true, accessLocked: false, authenticated: false,
      quickTracks: [{ id: 'popular', title: 'Popular', artists: ['Artist'], durationMs: 180_000, streamUrl: '/api/public-search/tracks/popular/stream?ticket=signed-ticket' }],
      playlists: [], recommendations: [], rediscover: [], localPlaylists: [], likedTracks: [], likedCount: 0,
      xedocRecommendations: [], xedocCollections: [],
    })

    render(createElement(PlayerProvider, null, createElement(App)))
    fireEvent.click(await screen.findByRole('button', { name: 'Топ треков' }))

    expect(await screen.findByRole('heading', { name: /слушают сейчас/ })).toBeInTheDocument()
    expect(getListeningStats).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Слушать топ' })).toBeEnabled()
    expect(screen.queryByRole('dialog', { name: 'Вход или регистрация' })).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/top')
  })

  it('keeps the same audio instance while opening a profile and returning through the logo', async () => {
    const audio = document.createElement('audio')
    const pause = vi.fn()
    Object.defineProperty(audio, 'pause', { value: pause })
    Object.defineProperty(audio, 'play', { value: vi.fn().mockResolvedValue(undefined) })
    const AudioMock = vi.fn(function AudioMock() { return audio })
    vi.stubGlobal('Audio', AudioMock)

    render(createElement(PlayerProvider, null, createElement(App)))
    fireEvent.click(await screen.findByRole('link', { name: 'Открыть публичный профиль' }))
    expect(await screen.findByRole('heading', { name: 'Music Listener' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Основная навигация' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'На главную' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))

    expect(AudioMock).toHaveBeenCalledTimes(1)
    expect(pause).not.toHaveBeenCalled()
  })

  it('keeps a timestamped shared track playing while leaving the share page through the logo', async () => {
    window.history.replaceState(null, '', '/share/public-share-token-123456?t=83')
    const audio = document.createElement('audio')
    const pause = vi.fn()
    const play = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(audio, 'pause', { value: pause })
    Object.defineProperty(audio, 'play', { value: play })
    Object.defineProperty(audio, 'load', { value: vi.fn() })
    Object.defineProperty(audio, 'duration', { configurable: true, value: 300 })
    const AudioMock = vi.fn(function AudioMock() { return audio })
    vi.stubGlobal('Audio', AudioMock)

    render(createElement(PlayerProvider, null, createElement(App)))

    expect(await screen.findByRole('heading', { name: 'Shared signal' })).toBeInTheDocument()
    await waitFor(() => expect(play).toHaveBeenCalled())
    expect(vi.mocked(getPublicShare)).toHaveBeenCalledWith('public-share-token-123456')
    audio.dispatchEvent(new Event('loadedmetadata'))
    expect(audio.currentTime).toBe(83)

    fireEvent.click(screen.getByRole('link', { name: /XEDOC PLAY/i }))

    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(window.location.search).toBe('')
    expect(await screen.findByRole('heading', { name: /Сессия под ваши правила/ })).toBeInTheDocument()
    expect(AudioMock).toHaveBeenCalledTimes(1)
    expect(pause).not.toHaveBeenCalled()
    expect(audio.currentTime).toBe(83)
  })
})
