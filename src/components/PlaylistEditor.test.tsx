import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

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

    await waitFor(() => expect(api.createLocalPlaylist).toHaveBeenCalledWith('My mix', '', false, undefined))
    expect(api.addTrackToLocalPlaylist).toHaveBeenCalledWith('local-new', track)
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ trackCount: 1 })))
  })
})

const coverData = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(80)

it('previews the cover before creating the playlist and saves it in the create request', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(coverData)
  const saved = { id: 'local-cover', title: 'Обложка', tracks: [], trackCount: 0, coverUrl: coverData }
  api.createLocalPlaylist.mockReset().mockResolvedValue(saved)
  const onSaved = vi.fn()
  const view = render(<PlaylistEditor open onClose={vi.fn()} onSaved={onSaved} />)
  fireEvent.change(screen.getByLabelText('Обложка плейлиста'), { target: { files: [new File(['image'], 'cover.png', { type: 'image/png' })] } })
  expect(await screen.findByRole('button', { name: 'Убрать обложку' })).toBeInTheDocument()
  expect(view.container.querySelector('.playlist-editor__cover img')).toHaveAttribute('src', coverData)
  expect(api.createLocalPlaylist).not.toHaveBeenCalled()
  fireEvent.change(screen.getByPlaceholderText('Например, Вечер без спешки'), { target: { value: 'Обложка' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(api.createLocalPlaylist).toHaveBeenCalledWith('Обложка', '', false, coverData))
  expect(onSaved).toHaveBeenCalledWith(saved)
})

it('lets a new playlist discard its selected cover before saving', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(coverData)
  const view = render(<PlaylistEditor open onClose={vi.fn()} onSaved={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Обложка плейлиста'), { target: { files: [new File(['image'], 'cover.png', { type: 'image/png' })] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Убрать обложку' }))
  expect(view.container.querySelector('.playlist-editor__cover img')).toBeNull()
})
