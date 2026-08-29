import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types'
import { PlayerProvider, usePlayer } from './PlayerContext'

const api = vi.hoisted(() => ({ toggleLike: vi.fn(), updateNowPlaying: vi.fn(), clearNowPlaying: vi.fn(), recordListeningEvent: vi.fn() }))

vi.mock('../lib/api', () => api)

class FakeAudio {
  static instances: FakeAudio[] = []
  listeners = new Map<string, Set<() => void>>()
  preload = ''
  volume = 1
  currentTime = 0
  duration = 240
  src = ''
  play = vi.fn().mockResolvedValue(undefined)
  pause = vi.fn()
  load = vi.fn()
  addEventListener = vi.fn((name: string, listener: () => void) => {
    const listeners = this.listeners.get(name) || new Set()
    listeners.add(listener)
    this.listeners.set(name, listeners)
  })
  removeEventListener = vi.fn((name: string, listener: () => void) => {
    this.listeners.get(name)?.delete(listener)
  })
  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = ''
  })

  constructor() {
    FakeAudio.instances.push(this)
  }

  emit(name: string) {
    this.listeners.get(name)?.forEach((listener) => listener())
  }
}

const track = (id: string, title: string, liked = false): Track => ({
  id,
  title,
  artists: ['Artist'],
  durationMs: 180_000,
  liked,
  streamUrl: `https://audio.test/${id}`,
})

let player: ReturnType<typeof usePlayer>

function Probe() {
  player = usePlayer()
  return null
}

function renderPlayer() {
  return render(<PlayerProvider><Probe /></PlayerProvider>)
}

describe('PlayerProvider state', () => {
  beforeEach(() => {
    window.localStorage.clear()
    FakeAudio.instances = []
    api.toggleLike.mockReset().mockResolvedValue(undefined)
    api.updateNowPlaying.mockReset().mockResolvedValue(undefined)
    api.clearNowPlaying.mockReset().mockResolvedValue(undefined)
    api.recordListeningEvent.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('Audio', FakeAudio)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not enter playing state without a current track or queue', () => {
    renderPlayer()
    act(() => player.togglePlayback())
    expect(player.isPlaying).toBe(false)
    expect(player.current).toBeUndefined()
  })

  it('navigates duplicate IDs by queue position and exposes the real upcoming order', () => {
    const firstDuplicate = track('same', 'First duplicate')
    const middle = track('middle', 'Middle')
    const secondDuplicate = track('same', 'Second duplicate')
    renderPlayer()

    act(() => player.playQueue([firstDuplicate, middle, secondDuplicate], 2))
    expect(player.current?.title).toBe('Second duplicate')
    expect(player.currentIndex).toBe(2)
    expect(player.upNext.map((item) => item.title)).toEqual(['First duplicate', 'Middle'])

    act(() => player.previous())
    expect(player.current?.title).toBe('Middle')
    expect(player.currentIndex).toBe(1)

    act(() => player.next())
    expect(player.current?.title).toBe('Second duplicate')
    act(() => player.next())
    expect(player.current?.title).toBe('First duplicate')
  })

  it('inserts the same track ID immediately after the active occurrence', () => {
    const first = track('same', 'First')
    const following = track('following', 'Following')
    const duplicate = track('same', 'Inserted duplicate')
    renderPlayer()

    act(() => player.playQueue([first, following]))
    act(() => player.addNext(duplicate))
    expect(player.queue.map((item) => item.title)).toEqual(['First', 'Inserted duplicate', 'Following'])
    expect(player.upNext.map((item) => item.title)).toEqual(['Inserted duplicate', 'Following'])

    act(() => player.next())
    expect(player.current?.title).toBe('Inserted duplicate')
    expect(player.currentIndex).toBe(1)
  })

  it('removes a queued occurrence without interrupting the current track', () => {
    const first = track('first', 'First')
    const following = track('following', 'Following')
    const last = track('last', 'Last')
    renderPlayer()

    act(() => player.playQueue([first, following, last], 1))
    act(() => player.removeFromQueue(last))

    expect(player.current?.title).toBe('Following')
    expect(player.currentIndex).toBe(1)
    expect(player.queue.map((item) => item.title)).toEqual(['First', 'Following'])
    act(() => player.removeFromQueue(player.current!))
    expect(player.queue.map((item) => item.title)).toEqual(['First', 'Following'])
  })

  it('normalizes repeated references into separately addressable queue occurrences', () => {
    const repeated = track('same', 'Repeated')
    const middle = track('middle', 'Middle')
    renderPlayer()

    act(() => player.playQueue([repeated, middle, repeated], 2))
    expect(player.currentIndex).toBe(2)
    expect(player.queue[0]).not.toBe(player.queue[2])
    expect(player.upNext).toEqual([player.queue[0], middle])

    act(() => player.next())
    expect(player.currentIndex).toBe(0)
  })

  it('never chooses the current position when shuffling a multi-track queue', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const tracks = [track('a', 'A'), track('b', 'B'), track('c', 'C')]
    renderPlayer()

    act(() => player.playQueue(tracks, 1))
    act(() => player.toggleShuffle())
    act(() => player.next())

    expect(player.currentIndex).toBe(2)
    expect(player.current?.title).toBe('C')
  })

  it('clears playback, queue and audio resources for logout', () => {
    renderPlayer()
    act(() => player.playQueue([track('a', 'A')]))
    act(() => player.clear())

    expect(player.current).toBeUndefined()
    expect(player.currentIndex).toBe(-1)
    expect(player.queue).toEqual([])
    expect(player.upNext).toEqual([])
    expect(player.isPlaying).toBe(false)
    expect(player.progress).toBe(0)
    expect(player.duration).toBe(0)
    expect(FakeAudio.instances[0].pause).toHaveBeenCalled()
    expect(FakeAudio.instances[0].removeAttribute).toHaveBeenCalledWith('src')
    expect(FakeAudio.instances[0].load).toHaveBeenCalled()
    expect(window.localStorage.getItem('xedoc-player-state-v1')).toBeNull()
  })

  it('restores the queue, current track and paused position after remounting', async () => {
    const first = track('a', 'A')
    const second = track('b', 'B')
    const view = renderPlayer()

    act(() => player.playQueue([first, second], 1, { playlistId: 'mix', playlistTitle: 'Mix' }))
    act(() => player.seek(67))
    act(() => player.toggleShuffle())
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('xedoc-player-state-v1') || '{}')).toMatchObject({
      currentIndex: 1,
      progress: 67,
      shuffle: true,
      playbackSource: { playlistId: 'mix', playlistTitle: 'Mix' },
    }))

    view.unmount()
    renderPlayer()
    expect(player.current?.id).toBe('b')
    expect(player.queue.map((item) => item.id)).toEqual(['a', 'b'])
    expect(player.currentIndex).toBe(1)
    expect(player.progress).toBe(67)
    expect(player.shuffle).toBe(true)
    expect(player.isPlaying).toBe(false)

    act(() => FakeAudio.instances.at(-1)?.emit('loadedmetadata'))
    expect(FakeAudio.instances.at(-1)?.currentTime).toBe(67)
  })

  it('starts a shared track from the requested second', () => {
    renderPlayer()

    act(() => player.playQueue([track('shared', 'Shared')], 0, undefined, 83))
    expect(player.progress).toBe(83)
    act(() => FakeAudio.instances.at(-1)?.emit('loadedmetadata'))
    expect(FakeAudio.instances.at(-1)?.currentTime).toBe(83)
    expect(FakeAudio.instances.at(-1)?.play).toHaveBeenCalled()
  })

  it('ignores invalid persisted playback data', () => {
    window.localStorage.setItem('xedoc-player-state-v1', JSON.stringify({ queue: [{ id: 5 }], currentIndex: 9, progress: 'bad' }))
    renderPlayer()
    expect(player.current).toBeUndefined()
    expect(player.queue).toEqual([])
    expect(player.progress).toBe(0)
  })

  it('persists a deduped recent-first history with timestamps and no stream URLs', async () => {
    const now = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000)
    const first = track('a', 'A')
    const second = track('b', 'B')
    const view = renderPlayer()

    act(() => player.playQueue([first, second]))
    await waitFor(() => expect(player.historyEntries[0]?.playedAt).toBe(1_000))
    act(() => player.next())
    await waitFor(() => expect(player.historyEntries[0]?.playedAt).toBe(2_000))
    act(() => player.next())
    await waitFor(() => expect(player.historyEntries[0]?.playedAt).toBe(3_000))

    expect(player.history.map((item) => item.id)).toEqual(['a', 'b'])
    const persisted = JSON.parse(window.localStorage.getItem('xedoc-play-history-v1') || '[]')
    expect(persisted).toHaveLength(2)
    expect(persisted[0]).toMatchObject({ track: { id: 'a' }, playedAt: 3_000 })
    expect(persisted[0].track).not.toHaveProperty('streamUrl')

    view.unmount()
    renderPlayer()
    expect(player.history.map((item) => item.id)).toEqual(['a', 'b'])
    expect(player.historyEntries[0].playedAt).toBe(3_000)
    now.mockRestore()
  })

  it('optimistically synchronizes likes and rolls them back when the API fails', async () => {
    const likedTrack = track('liked', 'Liked', true)
    renderPlayer()
    act(() => player.playQueue([likedTrack]))

    await act(async () => player.setTrackLiked(player.current!, false))
    expect(api.toggleLike).toHaveBeenCalledWith(expect.objectContaining({ id: 'liked' }), false)
    expect(player.isTrackLiked(player.current!)).toBe(false)
    expect(player.queue[0].liked).toBe(false)

    api.toggleLike.mockRejectedValueOnce(new Error('offline'))
    await act(async () => {
      await expect(player.setTrackLiked(player.current!, true)).rejects.toThrow('offline')
    })
    expect(player.isTrackLiked(player.current!)).toBe(false)
    expect(player.queue[0].liked).toBe(false)
  })

  it('publishes the active track with playlist context and clears it on pause', async () => {
    const liveTrack = track('live', 'Live')
    renderPlayer()

    act(() => player.playQueue([liveTrack], 0, { playlistId: 'local-open', playlistTitle: 'Open mix' }))
    await waitFor(() => expect(api.updateNowPlaying).toHaveBeenCalledWith(liveTrack, 'local-open'))

    act(() => player.togglePlayback())
    await waitFor(() => expect(api.clearNowPlaying).toHaveBeenCalled())
  })
})
