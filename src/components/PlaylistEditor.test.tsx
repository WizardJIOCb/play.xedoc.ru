import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Playlist, Track } from '../types'
import { PlaylistEditor } from './PlaylistEditor'

const api = vi.hoisted(() => ({
  addTrackToLocalPlaylist: vi.fn(),
  createLocalPlaylist: vi.fn(),
  deleteLocalPlaylist: vi.fn(),
  getPlaylist: vi.fn(),
  removeTrackFromLocalPlaylist: vi.fn(),
  searchMusic: vi.fn(),
  updateLocalPlaylist: vi.fn(),
  updateLocalPlaylistCover: vi.fn(),
}))

vi.mock('../lib/api', () => api)

describe('PlaylistEditor', () => {
  const track: Track = { id: 'found', title: 'Found song', artists: ['Found artist'], durationMs: 180_000 }
  const emptyPlaylist: Playlist = { id: 'local-new', title: 'My mix', trackCount: 0, tracks: [], local: true }

  beforeEach(() => {
    vi.clearAllMocks()
    api.searchMusic.mockResolvedValue({ tracks: [track], playlists: [], profiles: [] })
    api.createLocalPlaylist.mockResolvedValue(emptyPlaylist)
    api.addTrackToLocalPlaylist.mockResolvedValue({ ...emptyPlaylist, trackCount: 1, tracks: [track] })
  })

  it('finds a track and saves it into a newly created playlist', async () => {
    const onSaved = vi.fn()
    render(<PlaylistEditor open onClose={vi.fn()} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('Поиск треков для плейлиста'), { target: { value: 'Found artist' } })
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }))
    expect(await screen.findByText('Found song')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(screen.getByText('1 в плейлисте')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Например, Вечер без спешки'), { target: { value: 'My mix' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(api.createLocalPlaylist).toHaveBeenCalledWith('My mix', '', false))
    expect(api.addTrackToLocalPlaylist).toHaveBeenCalledWith('local-new', track)
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ trackCount: 1 })))
  })
})
