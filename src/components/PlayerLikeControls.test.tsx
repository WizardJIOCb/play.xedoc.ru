import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerProvider, usePlayer } from '../player/PlayerContext'
import type { Track } from '../types'
import { PlayerBar } from './PlayerBar'
import { TrackRow } from './TrackRow'

const api = vi.hoisted(() => ({ toggleLike: vi.fn(), updateNowPlaying: vi.fn(), clearNowPlaying: vi.fn(), recordListeningEvent: vi.fn() }))

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
})
