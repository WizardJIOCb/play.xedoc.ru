import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PlayerProvider } from './player/PlayerContext'
import type { Track } from './types'
import { filterCollectionTracks, stabilizeTrackOrder } from './App'

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
  }
})

const liked: Track = { id: 'liked', title: 'Liked', artists: ['Artist'], durationMs: 180_000, liked: true }
const removed: Track = { id: 'removed', title: 'Removed', artists: ['Artist'], durationMs: 180_000, liked: false }

describe('favorite collection filtering', () => {
  afterEach(() => {
    cleanup()
    window.history.replaceState(null, '', '/')
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
})
