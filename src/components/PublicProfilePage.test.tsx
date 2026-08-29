import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
    getPublicListeningHistory: vi.fn().mockImplementation((_username: string, offset = 0) => Promise.resolve(offset === 0 ? {
      items: [
        { eventId: 30, playedAt: 1_700_000_030, track: { id: 'recent-3', title: 'Recent track 3', artists: ['Recent artist'], durationMs: 180_000 } },
        { eventId: 20, playedAt: 1_700_000_020, track: { id: 'recent-2', title: 'Recent track 2', artists: ['Recent artist'], durationMs: 180_000 } },
        { eventId: 10, playedAt: 1_700_000_010, track: { id: 'recent-1', title: 'Recent track 1', artists: ['Recent artist'], durationMs: 180_000 } },
      ],
      total: 5, offset: 0, limit: 3, hasMore: true,
    } : {
      items: [
        { eventId: 5, playedAt: 1_700_000_005, track: { id: 'recent-4', title: 'Recent track 4', artists: ['Recent artist'], durationMs: 180_000 } },
        { eventId: 1, playedAt: 1_700_000_001, track: { id: 'recent-5', title: 'Recent track 5', artists: ['Recent artist'], durationMs: 180_000 } },
      ],
      total: 5, offset: 3, limit: 6, hasMore: false,
    })),
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
    expect(screen.getByRole('region', { name: 'Музыкальная активность' })).toBeInTheDocument()
    const nowPlaying = screen.getByRole('group', { name: 'Слушает сейчас' })
    expect(nowPlaying.firstElementChild).toHaveClass('public-profile-now-playing__cover')
    expect(within(nowPlaying).getByText('Live track')).toBeInTheDocument()
    expect(within(nowPlaying).queryByRole('button', { name: /Live track/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'История прослушиваний' })).toBeInTheDocument()
    expect(screen.getByText('Recent track 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Загрузить ещё' })).toBeInTheDocument()
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

  it('loads more listening history without exposing a control for the remote track', async () => {
    render(<PlayerProvider><PublicProfilePage username="listener" /></PlayerProvider>)

    expect(await screen.findByText('Recent track 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Live track/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }))
    expect(await screen.findByText('Recent track 5')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Загрузить ещё' })).not.toBeInTheDocument()
  })
})
