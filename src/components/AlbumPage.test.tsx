import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types'
import { AlbumPage } from './AlbumPage'

const mocks = vi.hoisted(() => ({ getAlbum: vi.fn(), playQueue: vi.fn() }))

vi.mock('../lib/api', () => ({ getAlbum: mocks.getAlbum }))
vi.mock('../player/PlayerContext', () => ({ usePlayer: () => ({ playQueue: mocks.playQueue }) }))
vi.mock('./TrackRow', () => ({ TrackRow: ({ track }: { track: Track }) => <div data-testid="album-track">{track.title}</div> }))

describe('AlbumPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/album?title=3+To+The+Floor&artist=PILOTE&id=album-3')
    mocks.playQueue.mockReset()
    mocks.getAlbum.mockReset().mockResolvedValue({
      id: 'album-3',
      title: '3 To The Floor',
      artists: ['PILOTE'],
      releaseDate: '2023-10-06',
      genre: 'Electronic',
      tracks: [
        { id: 'one', title: 'First', artists: ['PILOTE'], durationMs: 180_000 },
        { id: 'two', title: 'Turtle', artists: ['PILOTE'], durationMs: 308_000 },
      ],
    })
  })

  afterEach(() => {
    cleanup()
    window.history.replaceState(null, '', '/')
  })

  it('loads the complete album URL and can play its track list', async () => {
    render(<AlbumPage />)

    expect(await screen.findByRole('heading', { name: '3 To The Floor' })).toBeInTheDocument()
    expect(mocks.getAlbum).toHaveBeenCalledWith({ id: 'album-3', title: '3 To The Floor', artist: 'PILOTE' })
    expect(screen.getAllByTestId('album-track')).toHaveLength(2)
    expect(screen.getByText('2023 · Electronic · 2 трека')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Слушать' }))
    await waitFor(() => expect(mocks.playQueue).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'one' }), expect.objectContaining({ id: 'two' })])))
  })
})
