import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
  }
})

describe('PublicProfilePage', () => {
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
})
