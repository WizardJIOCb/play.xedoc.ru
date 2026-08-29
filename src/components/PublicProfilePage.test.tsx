import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlayerProvider } from '../player/PlayerContext'
import { PublicProfilePage } from './PublicProfilePage'

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>()
  return {
    ...original,
    getPublicProfile: vi.fn().mockResolvedValue({
      username: 'listener',
      displayName: 'Music Listener',
      memberSince: 1_700_000_000,
      publicPlaylistCount: 1,
      stats: { totalPlays: 42, uniqueTracks: 9, totalListenedMs: 7_200_000 },
      topTracks: [{ id: 'top', title: 'Top track', artists: ['Top artist'], durationMs: 210_000, streamUrl: '/api/public-top', playCount: 7 }],
      playlists: [{ id: 'local-open', title: 'Open mix', trackCount: 8, isPublic: true }],
      nowPlaying: {
        updatedAt: 1_700_000_100,
        track: { id: 'live', title: 'Live track', artists: ['Live artist'], durationMs: 180_000, streamUrl: '/api/live' },
        playlist: { id: 'local-open', title: 'Open mix', trackCount: 8, isPublic: true },
      },
    }),
    getPublicProfilePlaylist: vi.fn().mockResolvedValue({
      id: 'local-open', title: 'Open mix', trackCount: 1, isPublic: true,
      tracks: [{ id: 'live', title: 'Live track', artists: ['Live artist'], durationMs: 180_000, streamUrl: '/api/live' }],
    }),
    updateAccountProfile: vi.fn().mockResolvedValue({
      id: 'user-listener', username: 'listener', displayName: 'Renamed Listener', needsPassword: false, isAdmin: false,
    }),
  }
})

describe('PublicProfilePage', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('shows public identity, aggregate stats and public playlists', async () => {
    render(<PlayerProvider><PublicProfilePage username="listener" /></PlayerProvider>)

    expect(await screen.findByRole('heading', { name: 'Music Listener' })).toBeInTheDocument()
    expect(screen.getByText('@listener')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Open mix/ })).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'Слушает сейчас' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Live track/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Включить Top track' })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: /Open mix/ })[0])
    expect(await screen.findByRole('heading', { name: 'Open mix' })).toBeInTheDocument()
  })

  it('lets the profile owner change the displayed name', async () => {
    render(<PlayerProvider><PublicProfilePage username="listener" embedded viewer={{ id: 'user-listener', username: 'listener', displayName: 'Music Listener', needsPassword: false, isAdmin: false }} /></PlayerProvider>)

    fireEvent.click(await screen.findByRole('button', { name: 'Изменить профиль' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Отображаемое имя' }), { target: { value: 'Renamed Listener' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByRole('heading', { name: 'Renamed Listener' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('pauses the current now-playing track from its profile card', async () => {
    const audio = document.createElement('audio')
    Object.defineProperty(audio, 'play', { value: vi.fn().mockResolvedValue(undefined) })
    Object.defineProperty(audio, 'pause', { value: vi.fn() })
    Object.defineProperty(audio, 'load', { value: vi.fn() })
    vi.stubGlobal('Audio', vi.fn(function AudioMock() { return audio }))
    render(<PlayerProvider><PublicProfilePage username="listener" /></PlayerProvider>)

    fireEvent.click(await screen.findByRole('button', { name: 'Включить Live track' }))
    const pauseButton = screen.getByRole('button', { name: 'Пауза Live track' })
    expect(pauseButton.querySelector('.lucide-pause')).toBeInTheDocument()
    fireEvent.click(pauseButton)
    expect(screen.getByRole('button', { name: 'Включить Live track' }).querySelector('.lucide-play')).toBeInTheDocument()
  })
})
