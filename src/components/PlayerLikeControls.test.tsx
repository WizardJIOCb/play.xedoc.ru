import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerProvider, usePlayer } from '../player/PlayerContext'
import type { Track } from '../types'
import { PlayerBar } from './PlayerBar'
import { TrackRow } from './TrackRow'

const api = vi.hoisted(() => ({ toggleLike: vi.fn(), updateNowPlaying: vi.fn(), clearNowPlaying: vi.fn(), recordListeningEvent: vi.fn(), getTrackPlayCount: vi.fn() }))

vi.mock('../lib/api', () => api)

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

const likedTrack: Track = { id: 'one', title: 'One', artists: ['Artist'], durationMs: 180_000, liked: true }
const unlikedTrack: Track = { id: 'two', title: 'Two', artists: ['Artist'], durationMs: 180_000, liked: false }
const generatedTrack: Track = { id: 'generated:one', title: 'Machine Rising', artists: ['YuE2 · XEDOC Play'], durationMs: 180_000, generated: true, lyrics: '[Verse]\nThe machines are waking up' }

function PlayingBar({ track }: { track: Track }) {
  const player = usePlayer()
  useEffect(() => player.playTrack(track, [track]), [player.playTrack, track])
  return <PlayerBar onQueue={() => undefined} />
}

describe('player like controls', () => {
  beforeEach(() => {
    window.localStorage.clear()
    api.toggleLike.mockReset().mockResolvedValue(undefined)
    api.updateNowPlaying.mockReset().mockResolvedValue(undefined)
    api.clearNowPlaying.mockReset().mockResolvedValue(undefined)
    api.recordListeningEvent.mockReset().mockResolvedValue(undefined)
    api.getTrackPlayCount.mockReset().mockResolvedValue(0)
    vi.stubGlobal('Audio', FakeAudio)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('initializes from the current track, persists the change, and resets for another track', async () => {
    const view = render(<PlayerProvider><PlayingBar track={likedTrack} /></PlayerProvider>)
    const unlike = await screen.findByRole('button', { name: 'Убрать лайк' })
    expect(screen.getByRole('link', { name: 'Artist' })).toHaveAttribute('href', '/search?q=Artist&type=artist')
    fireEvent.click(unlike)

    await waitFor(() => expect(api.toggleLike).toHaveBeenCalledWith(expect.objectContaining({ id: 'one' }), false))
    expect(screen.getByRole('button', { name: 'Поставить лайк' })).toBeInTheDocument()

    view.rerender(<PlayerProvider><PlayingBar track={unlikedTrack} /></PlayerProvider>)
    expect(await screen.findByRole('button', { name: 'Поставить лайк' })).toBeInTheDocument()
  })

  it('uses the same API-backed liked state in track rows', async () => {
    render(<PlayerProvider><TrackRow track={likedTrack} context={[likedTrack]} /></PlayerProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Убрать лайк' }))

    await waitFor(() => expect(api.toggleLike).toHaveBeenCalledWith(expect.objectContaining({ id: 'one' }), false))
    expect(screen.getByRole('button', { name: 'Поставить лайк' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Включить One' })).toBeInTheDocument()
  })

  it('starts playback when the track row itself is clicked', async () => {
    render(<PlayerProvider><TrackRow track={unlikedTrack} context={[unlikedTrack]} /></PlayerProvider>)

    fireEvent.click(screen.getByText('Two'))

    expect(await screen.findByRole('button', { name: 'Пауза' })).toBeInTheDocument()
  })

  it('shows playlist and remove actions for a track in the queue', () => {
    const removeFromQueue = vi.fn()
    render(<PlayerProvider><TrackRow track={unlikedTrack} context={[unlikedTrack]} onQueueRemove={removeFromQueue} /></PlayerProvider>)

    expect(screen.getByRole('button', { name: 'Добавить Two в плейлист или очередь' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Убрать Two из очереди' }))
    expect(removeFromQueue).toHaveBeenCalledOnce()
  })

  it.each([{ compact: false }, { compact: true }, { readonly: true }])('keeps inline seeking and volume in sync with the player (%j)', async (props) => {
    const tracks = [likedTrack, unlikedTrack]
    render(<PlayerProvider>{tracks.map((track) => <TrackRow key={track.id} track={track} context={tracks} {...props} />)}<PlayerBar onQueue={() => undefined} /></PlayerProvider>)
    expect(screen.queryByRole('slider', { name: 'Перемотка One' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Включить One' }))
    const seek = await screen.findByRole('slider', { name: 'Перемотка One' })
    fireEvent.click(seek)
    fireEvent.change(seek, { target: { value: '90' } })
    expect(screen.getByRole('slider', { name: 'Позиция воспроизведения' })).toHaveValue('90')
    expect(screen.getAllByRole('button', { name: 'Пауза' })).toHaveLength(2)
    fireEvent.change(screen.getByRole('slider', { name: 'Громкость One' }), { target: { value: '.25' } })
    expect(screen.getByRole('slider', { name: 'Громкость' })).toHaveValue('0.25')
    fireEvent.change(screen.getByRole('slider', { name: 'Громкость' }), { target: { value: '.6' } })
    expect(screen.getByRole('slider', { name: 'Громкость One' })).toHaveValue('0.6')
    fireEvent.click(screen.getAllByRole('button', { name: 'Пауза' })[0])
    fireEvent.change(seek, { target: { value: '120' } })
    expect(screen.getByRole('slider', { name: 'Позиция воспроизведения' })).toHaveValue('120')
    expect(screen.getByRole('button', { name: 'Воспроизвести' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Включить Two' }))
    expect(screen.queryByRole('slider', { name: 'Перемотка One' })).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Перемотка Two' })).toHaveValue('0')
    expect(screen.getByRole('slider', { name: 'Громкость Two' })).toHaveValue('0.6')
  })

  it('shows the lyrics of a generated track in the player', async () => {
    render(<PlayerProvider><PlayingBar track={generatedTrack} /></PlayerProvider>)

    expect(await screen.findByText('YuE2 · XEDOC Play')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Показать текст песни' }))
    expect(screen.getByRole('dialog', { name: 'Текст песни: Machine Rising' })).toHaveTextContent('The machines are waking up')
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть окно текста песни' }))
    expect(screen.queryByRole('dialog', { name: 'Текст песни: Machine Rising' })).not.toBeInTheDocument()
  })
})
