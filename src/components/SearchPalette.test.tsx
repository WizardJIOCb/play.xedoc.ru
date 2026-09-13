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
  getTrackPlayCount: vi.fn(),
  createTrackShare: vi.fn(),
}))

vi.mock('../lib/api', () => api)
vi.mock('../lib/analytics', () => ({ trackGoal: vi.fn() }))

const suggestion: Track = { id: 'quick', title: 'Быстрый трек', artists: ['Исполнитель'], durationMs: 180_000 }
const secondSuggestion: Track = { id: 'second', title: 'Другой трек', artists: ['Другой исполнитель'], durationMs: 175_000 }
const result: Track = { id: 'result', title: 'Найденный трек', artists: ['Новый артист'], durationMs: 190_000 }

class FakeAudio {
  preload = ''
  volume = 1
  currentTime = 0
  duration = 180
  src = ''
  play = vi.fn().mockResolvedValue(undefined)
  pause = vi.fn()
  load = vi.fn()
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  removeAttribute = vi.fn()
}

describe('content search page', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/search')
    api.searchMusic.mockReset().mockResolvedValue({ tracks: [result], playlists: [], profiles: [] })
    api.toggleLike.mockReset().mockResolvedValue(undefined)
    api.updateNowPlaying.mockReset().mockResolvedValue(undefined)
    api.clearNowPlaying.mockReset().mockResolvedValue(undefined)
    api.recordListeningEvent.mockReset().mockResolvedValue(undefined)
    api.getTrackPlayCount.mockReset().mockResolvedValue(0)
    api.createTrackShare.mockReset().mockResolvedValue({ token: 'track-token', path: '/share/track-token' })
    vi.stubGlobal('Audio', FakeAudio)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each([false, true])('copies an artist search link, including in public mode (%s)', async (publicMode) => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }))
    window.history.replaceState(null, '', '/search?q=Vinnie+Paz&type=artist&utm_source=test#old')
    render(<PlayerProvider><SearchPalette suggestions={[]} onPlaylistPlay={() => undefined} publicMode={publicMode} /></PlayerProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать ссылку' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/search?q=Vinnie+Paz&type=artist`))
    expect(await screen.findByRole('status')).toHaveTextContent('Ссылка скопирована')
  })

  it('copies the current query with special characters and hides sharing for an empty query', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }))
    render(<PlayerProvider><SearchPalette suggestions={[]} onPlaylistPlay={() => undefined} /></PlayerProvider>)
    expect(screen.queryByRole('button', { name: 'Скопировать ссылку' })).not.toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'Поисковый запрос' })
    fireEvent.change(input, { target: { value: '  Кино & AC/DC + #1  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать ссылку' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    const copied = new URL(writeText.mock.calls[0][0])
    expect(copied.searchParams.get('q')).toBe('Кино & AC/DC + #1')
    expect(copied.searchParams.has('type')).toBe(false)
    fireEvent.change(input, { target: { value: 'Signal' } })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать ссылку' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/search?q=Signal`))
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }))
    expect(screen.queryByRole('button', { name: 'Скопировать ссылку' })).not.toBeInTheDocument()
  })

  it('offers a selectable search link when clipboard access is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }))
    window.history.replaceState(null, '', '/search?q=Signal')
    render(<PlayerProvider><SearchPalette suggestions={[]} onPlaylistPlay={() => undefined} publicMode /></PlayerProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать ссылку' }))
    expect(await screen.findByRole('textbox', { name: 'Ссылка на результаты поиска' })).toHaveValue(`${window.location.origin}/search?q=Signal`)
    expect(screen.getByRole('status')).toHaveTextContent('Не удалось скопировать')
  })

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

  it('shows duration, updates elapsed time from audio, and preserves it while paused', () => {
    const audio = document.createElement('audio')
    Object.defineProperty(audio, 'play', { value: vi.fn().mockResolvedValue(undefined) })
    Object.defineProperty(audio, 'pause', { value: vi.fn() })
    Object.defineProperty(audio, 'load', { value: vi.fn() })
    Object.defineProperty(audio, 'duration', { configurable: true, value: 221 })
    vi.stubGlobal('Audio', vi.fn(function AudioMock() { return audio }))
    render(<PlayerProvider><SearchPalette suggestions={[suggestion, secondSuggestion]} onPlaylistPlay={() => undefined} /></PlayerProvider>)

    expect(screen.getByText('3:00')).toBeInTheDocument()
    expect(screen.getByText('2:55')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Включить Быстрый трек' }))
    fireEvent.loadedMetadata(audio)
    audio.currentTime = 74
    fireEvent.timeUpdate(audio)
    expect(screen.getByText('1:14 / 3:41')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Пауза Быстрый трек' }))
    expect(screen.getByText('1:14 / 3:41')).toBeInTheDocument()
    audio.currentTime = 102
    fireEvent.timeUpdate(audio)
    expect(screen.getByText('1:42 / 3:41')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Включить Другой трек' }))
    expect(screen.getByText('0:00 / 2:55')).toBeInTheDocument()
    expect(screen.getByText('3:00')).toBeInTheDocument()
  })

  it.each([false, true])('seeks the active search result while playing and paused (public: %s)', async (publicMode) => {
    const audio = document.createElement('audio')
    Object.defineProperty(audio, 'play', { value: vi.fn().mockResolvedValue(undefined) })
    Object.defineProperty(audio, 'pause', { value: vi.fn() })
    Object.defineProperty(audio, 'load', { value: vi.fn() })
    Object.defineProperty(audio, 'duration', { configurable: true, value: 221 })
    vi.stubGlobal('Audio', vi.fn(function AudioMock() { return audio }))
    window.history.replaceState(null, '', '/search?q=Новый')
    api.searchMusic.mockResolvedValue({ tracks: [result, secondSuggestion], playlists: [], profiles: [] })
    render(<PlayerProvider><SearchPalette suggestions={[]} onPlaylistPlay={() => undefined} publicMode={publicMode} /></PlayerProvider>)

    fireEvent.click(await screen.findByRole('button', { name: 'Включить Найденный трек' }))
    fireEvent.loadedMetadata(audio)
    const seek = screen.getByRole('slider', { name: 'Перемотка Найденный трек' })
    expect(seek).toHaveAttribute('max', '221')
    expect(screen.getAllByRole('slider')).toHaveLength(2)
    expect(screen.getByRole('slider', { name: 'Громкость Найденный трек' })).toBeInTheDocument()
    fireEvent.click(seek)
    fireEvent.change(seek, { target: { value: '90' } })
    expect(audio.currentTime).toBe(90)
    expect(screen.getByText('1:30 / 3:41')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Пауза Найденный трек' })).toBeInTheDocument()

    audio.currentTime = 95
    fireEvent.timeUpdate(audio)
    expect(seek).toHaveValue('95')
    fireEvent.click(screen.getByRole('button', { name: 'Пауза Найденный трек' }))
    fireEvent.change(seek, { target: { value: '120' } })
    expect(audio.currentTime).toBe(120)
    expect(seek).toHaveAttribute('aria-valuetext', '2:00 из 3:41')
    expect(screen.getByRole('button', { name: 'Включить Найденный трек' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Включить Другой трек' }))
    expect(screen.queryByRole('slider', { name: 'Перемотка Найденный трек' })).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Перемотка Другой трек' })).toHaveValue('0')
  })

  it('shares the current search track with one click and keeps playback unchanged', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }))
    window.history.replaceState(null, '', '/search?q=Новый')
    api.searchMusic.mockResolvedValue({ tracks: [result, secondSuggestion], playlists: [], profiles: [] })
    render(<PlayerProvider><SearchPalette suggestions={[]} onPlaylistPlay={() => undefined} /></PlayerProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Включить Найденный трек' }))
    fireEvent.click(screen.getByRole('button', { name: 'Поделиться: Найденный трек' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/track-token`))
    expect(api.createTrackShare).toHaveBeenCalledWith(result)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Пауза Найденный трек' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Перемотка Найденный трек' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Пауза Найденный трек' }))
    expect(screen.getByRole('button', { name: 'Ссылка скопирована: Найденный трек' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Включить Другой трек' }))
    expect(screen.getByRole('button', { name: 'Поделиться: Другой трек' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ссылка скопирована: Найденный трек' })).not.toBeInTheDocument()
  })

  it('shows pause only for the search result that is currently playing', () => {
    render(<PlayerProvider><SearchPalette suggestions={[suggestion, secondSuggestion]} onPlaylistPlay={() => undefined} /></PlayerProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Включить Быстрый трек' }))

    expect(screen.getByRole('button', { name: 'Пауза Быстрый трек' }).closest('.search-result')).toHaveClass('search-result--active')
    expect(screen.getByRole('button', { name: 'Включить Другой трек' }).closest('.search-result')).not.toHaveClass('search-result--active')

    fireEvent.click(screen.getByRole('button', { name: 'Пауза Быстрый трек' }))
    expect(screen.getByRole('button', { name: 'Включить Быстрый трек' }).closest('.search-result')).not.toHaveClass('search-result--active')
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
