import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerProvider } from '../player/PlayerContext'
import type { Track } from '../types'
import { SearchPalette } from './SearchPalette'

const api = vi.hoisted(() => ({
  searchMusic: vi.fn(),
  toggleLike: vi.fn(),
  updateNowPlaying: vi.fn(),
  clearNowPlaying: vi.fn(),
  recordListeningEvent: vi.fn(),
}))

vi.mock('../lib/api', () => api)
vi.mock('../lib/analytics', () => ({ trackGoal: vi.fn() }))

const suggestion: Track = { id: 'quick', title: 'Быстрый трек', artists: ['Исполнитель'], durationMs: 180_000 }
const result: Track = { id: 'result', title: 'Найденный трек', artists: ['Новый артист'], durationMs: 190_000 }

describe('content search page', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/search')
    api.searchMusic.mockReset().mockResolvedValue({ tracks: [result], playlists: [], profiles: [] })
    api.toggleLike.mockReset().mockResolvedValue(undefined)
    api.updateNowPlaying.mockReset().mockResolvedValue(undefined)
    api.clearNowPlaying.mockReset().mockResolvedValue(undefined)
    api.recordListeningEvent.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  it('renders inline and keeps results in the content area', async () => {
    const view = render(<PlayerProvider><SearchPalette suggestions={[suggestion]} onPlaylistPlay={() => undefined} /></PlayerProvider>)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(view.container.querySelector('.overlay')).not.toBeInTheDocument()
    expect(screen.getByText('Быстрый трек')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Поисковый запрос' }), { target: { value: 'Новый' } })

    await waitFor(() => expect(api.searchMusic).toHaveBeenCalledWith('Новый', false))
    expect(await screen.findByText('Найденный трек')).toBeInTheDocument()
    expect(view.container.querySelector('.search-page__content')).toContainElement(screen.getByText('Найденный трек'))
    expect(screen.getByRole('button', { name: 'Добавить Найденный трек в плейлист или очередь' })).toBeInTheDocument()
  })

  it('offers track search without registration in public mode', async () => {
    render(<PlayerProvider><SearchPalette suggestions={[]} onPlaylistPlay={() => undefined} publicMode /></PlayerProvider>)

    expect(screen.getByText('ПУБЛИЧНЫЙ ПОИСК XEDOC')).toBeInTheDocument()
    expect(screen.getByText(/регистрация не нужна/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Поисковый запрос' }), { target: { value: 'Signal' } })

    await waitFor(() => expect(api.searchMusic).toHaveBeenCalledWith('Signal', false))
    expect(await screen.findByText('Найденный трек')).toBeInTheDocument()
    expect(screen.queryByText('Плейлисты')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Добавить Найденный трек в плейлист/ })).not.toBeInTheDocument()
  })

  it('hands a selected playlist to the side-queue action', async () => {
    const onPlaylistPlay = vi.fn()
    api.searchMusic.mockResolvedValue({ tracks: [], playlists: [{ id: 'mix-1', title: 'Найденный плейлист', trackCount: 20 }], profiles: [] })
    render(<PlayerProvider><SearchPalette suggestions={[]} onPlaylistPlay={onPlaylistPlay} /></PlayerProvider>)

    fireEvent.change(screen.getByRole('textbox', { name: 'Поисковый запрос' }), { target: { value: 'Микс' } })
    expect(await screen.findByText('Найденный плейлист')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Найденный плейлист/ }))

    expect(onPlaylistPlay).toHaveBeenCalledWith(expect.objectContaining({ id: 'mix-1', title: 'Найденный плейлист' }))
  })

  it('loads and shows the full artist catalog from an artist link', async () => {
    const artistTracks = Array.from({ length: 14 }, (_, index) => ({
      id: `artist-${index}`,
      title: `Трек ${index + 1}`,
      artists: ['GUNSHIP'],
      durationMs: 180_000,
    }))
    window.history.replaceState(null, '', '/search?q=GUNSHIP&type=artist')
    api.searchMusic.mockResolvedValue({ tracks: artistTracks, playlists: [], profiles: [] })

    render(<PlayerProvider><SearchPalette suggestions={[]} onPlaylistPlay={() => undefined} publicMode /></PlayerProvider>)

    await waitFor(() => expect(api.searchMusic).toHaveBeenCalledWith('GUNSHIP', true))
    expect(screen.getByText('Треки исполнителя')).toBeInTheDocument()
    expect(await screen.findByText('Трек 14')).toBeInTheDocument()
  })
})
