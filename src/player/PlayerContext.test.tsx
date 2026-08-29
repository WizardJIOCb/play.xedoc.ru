import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types'
import { PlayerBar } from '../components/PlayerBar'
import { PlayerProvider, usePlayer } from './PlayerContext'

const api = vi.hoisted(() => ({ toggleLike: vi.fn(), updateNowPlaying: vi.fn(), clearNowPlaying: vi.fn(), recordListeningEvent: vi.fn(), getTrackPlayCount: vi.fn() }))

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

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  listeners = new Set<(event: MessageEvent) => void>()

  constructor(public name: string) {
    FakeBroadcastChannel.instances.push(this)
  }

  addEventListener(_name: string, listener: (event: MessageEvent) => void) {
    this.listeners.add(listener)
  }

  postMessage(data: unknown) {
    for (const channel of FakeBroadcastChannel.instances) {
      if (channel !== this && channel.name === this.name) {
        channel.listeners.forEach((listener) => listener({ data } as MessageEvent))
      }
    }
  }

  close() {
    FakeBroadcastChannel.instances = FakeBroadcastChannel.instances.filter((channel) => channel !== this)
    this.listeners.clear()
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
let firstPlayer: ReturnType<typeof usePlayer>
let secondPlayer: ReturnType<typeof usePlayer>

function Probe() {
  player = usePlayer()
  return null
}

function PairProbe({ slot }: { slot: 'first' | 'second' }) {
  const value = usePlayer()
  if (slot === 'first') firstPlayer = value
  else secondPlayer = value
  return null
}

function renderPlayer() {
  return render(<PlayerProvider><Probe /></PlayerProvider>)
}

describe('PlayerProvider state', () => {
  beforeEach(() => {
    window.localStorage.clear()
    FakeAudio.instances = []
    FakeBroadcastChannel.instances = []
    api.toggleLike.mockReset().mockResolvedValue(undefined)
    api.updateNowPlaying.mockReset().mockResolvedValue(undefined)
    api.clearNowPlaying.mockReset().mockResolvedValue(undefined)
    api.recordListeningEvent.mockReset().mockResolvedValue(undefined)
    api.getTrackPlayCount.mockReset().mockResolvedValue(0)
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
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

  it('mirrors active playback into a newly opened tab without starting a second audio stream', async () => {
    render(<PlayerProvider><PairProbe slot="first" /></PlayerProvider>)
    const tracks = [track('first-tab', 'First tab'), track('up-next', 'Up next')]

    act(() => firstPlayer.playQueue(tracks, 0, { playlistId: 'road-trip', playlistTitle: 'Road trip' }))
    act(() => firstPlayer.seek(37))
    await waitFor(() => expect(FakeAudio.instances[0].play).toHaveBeenCalled())

    render(<PlayerProvider><PairProbe slot="second" /></PlayerProvider>)
    await waitFor(() => {
      expect(secondPlayer.current?.id).toBe('first-tab')
      expect(secondPlayer.queue.map((item) => item.id)).toEqual(['first-tab', 'up-next'])
      expect(secondPlayer.progress).toBe(37)
      expect(secondPlayer.isPlaying).toBe(true)
      expect(secondPlayer.isRemotePlayback).toBe(true)
      expect(secondPlayer.playbackSource).toEqual({ playlistId: 'road-trip', playlistTitle: 'Road trip' })
    })
    expect(FakeAudio.instances[1].play).not.toHaveBeenCalled()
    expect(FakeAudio.instances[1].load).not.toHaveBeenCalled()
  })

  it('keeps the audio owner playing while a mirrored tab reloads', async () => {
    render(<PlayerProvider><PairProbe slot="first" /></PlayerProvider>)
    act(() => firstPlayer.playQueue([track('first-tab', 'First tab')]))
    await waitFor(() => expect(FakeAudio.instances[0].play).toHaveBeenCalled())

    const mirroredView = render(<PlayerProvider><PairProbe slot="second" /></PlayerProvider>)
    await waitFor(() => expect(secondPlayer.isRemotePlayback).toBe(true))
    mirroredView.unmount()
    render(<PlayerProvider><PairProbe slot="second" /></PlayerProvider>)

    await waitFor(() => {
      expect(firstPlayer.isPlaying).toBe(true)
      expect(secondPlayer.isPlaying).toBe(true)
      expect(secondPlayer.isRemotePlayback).toBe(true)
    })
    expect(FakeAudio.instances[0].pause).not.toHaveBeenCalled()
    expect(FakeAudio.instances[2].play).not.toHaveBeenCalled()
    expect(FakeAudio.instances[2].load).not.toHaveBeenCalled()
  })

  it('lets a mirrored tab pause the tab that owns the audio', async () => {
    render(<PlayerProvider><PairProbe slot="first" /></PlayerProvider>)
    act(() => firstPlayer.playQueue([track('first-tab', 'First tab')]))
    await waitFor(() => expect(FakeAudio.instances[0].play).toHaveBeenCalled())

    render(<PlayerProvider><PairProbe slot="second" /></PlayerProvider>)
    await waitFor(() => expect(secondPlayer.isRemotePlayback).toBe(true))

    act(() => secondPlayer.togglePlayback())
    await waitFor(() => {
      expect(firstPlayer.isPlaying).toBe(false)
      expect(secondPlayer.isPlaying).toBe(false)
    })
    expect(FakeAudio.instances[0].pause).toHaveBeenCalled()
    expect(FakeAudio.instances[1].play).not.toHaveBeenCalled()
  })

  it('lets a mirrored tab seek and change the volume in the tab that owns the audio', async () => {
    render(<PlayerProvider><PairProbe slot="first" /></PlayerProvider>)
    act(() => firstPlayer.playQueue([track('first-tab', 'First tab')]))
    await waitFor(() => expect(FakeAudio.instances[0].play).toHaveBeenCalled())

    render(<PlayerProvider><PairProbe slot="second" /><PlayerBar onQueue={() => undefined} /></PlayerProvider>)
    await waitFor(() => expect(secondPlayer.isRemotePlayback).toBe(true))

    const timeline = screen.getByRole('slider', { name: 'Позиция воспроизведения' })
    const volume = screen.getByRole('slider', { name: 'Громкость' })
    expect(timeline).toBeEnabled()
    expect(volume).toBeEnabled()

    fireEvent.change(timeline, { target: { value: '91' } })
    await waitFor(() => {
      expect(FakeAudio.instances[0].currentTime).toBe(91)
      expect(firstPlayer.progress).toBe(91)
      expect(secondPlayer.progress).toBe(91)
    })

    fireEvent.change(volume, { target: { value: '.31' } })
    await waitFor(() => {
      expect(FakeAudio.instances[0].volume).toBe(.31)
      expect(firstPlayer.volume).toBe(.31)
      expect(secondPlayer.volume).toBe(.31)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Выключить звук' }))
    await waitFor(() => {
      expect(FakeAudio.instances[0].volume).toBe(0)
      expect(firstPlayer.volume).toBe(0)
      expect(secondPlayer.volume).toBe(0)
    })
    expect(screen.getByRole('button', { name: 'Включить звук' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Включить звук' }))
    await waitFor(() => {
      expect(FakeAudio.instances[0].volume).toBe(.31)
      expect(firstPlayer.volume).toBe(.31)
      expect(secondPlayer.volume).toBe(.31)
    })
    expect(screen.getByRole('button', { name: 'Выключить звук' })).toHaveAttribute('aria-pressed', 'false')
    expect(FakeAudio.instances[1].play).not.toHaveBeenCalled()
  })

  it('shows the personal ordinal number for the current playback', async () => {
    api.getTrackPlayCount.mockResolvedValue(665)
    render(<PlayerProvider><Probe /><PlayerBar onQueue={() => undefined} /></PlayerProvider>)

    act(() => player.playQueue([track('often-played', 'Often played')]))

    await waitFor(() => expect(api.getTrackPlayCount).toHaveBeenCalledWith('often-played'))
    expect(screen.getByText(/Играет/)).toHaveTextContent('Играет (666-й раз)')
  })

  it('moves playback ownership when another tab starts a different track', async () => {
    render(<>
      <PlayerProvider><PairProbe slot="first" /></PlayerProvider>
      <PlayerProvider><PairProbe slot="second" /></PlayerProvider>
    </>)

    act(() => firstPlayer.playQueue([track('first-tab', 'First tab')]))
    await waitFor(() => expect(FakeAudio.instances[0].play).toHaveBeenCalled())

    act(() => secondPlayer.playQueue([track('second-tab', 'Second tab')]))
    await waitFor(() => {
      expect(secondPlayer.isPlaying).toBe(true)
      expect(secondPlayer.isRemotePlayback).toBe(false)
      expect(firstPlayer.current?.id).toBe('second-tab')
      expect(firstPlayer.isPlaying).toBe(true)
      expect(firstPlayer.isRemotePlayback).toBe(true)
    })
    expect(FakeAudio.instances[0].pause).toHaveBeenCalled()
    expect(FakeAudio.instances[1].play).toHaveBeenCalled()
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
