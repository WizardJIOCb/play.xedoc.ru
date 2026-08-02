import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { clearNowPlaying, recordListeningEvent, toggleLike as persistTrackLike, updateNowPlaying } from '../lib/api'
import { trackGoal } from '../lib/analytics'
import type { Track } from '../types'

export interface ListeningHistoryEntry {
  track: Track
  playedAt: number
}

export interface PlaybackSource {
  playlistId: string
  playlistTitle: string
}

interface PlayerContextValue {
  current?: Track
  currentIndex: number
  queue: Track[]
  upNext: Track[]
  history: Track[]
  historyEntries: ListeningHistoryEntry[]
  isPlaying: boolean
  progress: number
  duration: number
  volume: number
  shuffle: boolean
  repeat: boolean
  playTrack: (track: Track, context?: Track[], startIndex?: number, source?: PlaybackSource) => void
  playQueue: (tracks: Track[], startIndex?: number, source?: PlaybackSource) => void
  togglePlayback: () => void
  next: () => void
  previous: () => void
  seek: (seconds: number) => void
  setVolume: (value: number) => void
  toggleShuffle: () => void
  toggleRepeat: () => void
  addNext: (track: Track) => void
  isTrackLiked: (track: Track) => boolean
  setTrackLiked: (track: Track, liked: boolean) => Promise<void>
  clear: () => void
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

const HISTORY_STORAGE_KEY = 'xedoc-play-history-v1'
const PLAYER_STORAGE_KEY = 'xedoc-player-state-v1'
const HISTORY_LIMIT = 50
const QUEUE_STORAGE_LIMIT = 300
const coverTones = new Set(['lime', 'violet', 'coral', 'blue', 'amber', 'mono'])

interface PersistedPlaybackState {
  queue: Track[]
  currentIndex: number
  progress: number
  volume: number
  shuffle: boolean
  repeat: boolean
  playbackSource?: PlaybackSource
}

function safeHistoryTrack(value: unknown): Track | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<Track>
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.title !== 'string'
    || !Array.isArray(candidate.artists)
    || !candidate.artists.every((artist) => typeof artist === 'string')
    || typeof candidate.durationMs !== 'number'
    || !Number.isFinite(candidate.durationMs)
  ) return undefined

  return {
    id: candidate.id,
    title: candidate.title,
    artists: [...candidate.artists],
    durationMs: candidate.durationMs,
    ...(typeof candidate.album === 'string' ? { album: candidate.album } : {}),
    ...(typeof candidate.coverUrl === 'string' ? { coverUrl: candidate.coverUrl } : {}),
    ...(typeof candidate.coverTone === 'string' && coverTones.has(candidate.coverTone) ? { coverTone: candidate.coverTone } : {}),
    ...(typeof candidate.liked === 'boolean' ? { liked: candidate.liked } : {}),
    ...(typeof candidate.explicit === 'boolean' ? { explicit: candidate.explicit } : {}),
  }
}

function readHistoryEntries(): ListeningHistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []

    const seen = new Set<string>()
    return parsed
      .flatMap((value): ListeningHistoryEntry[] => {
        if (!value || typeof value !== 'object') return []
        const entry = value as Partial<ListeningHistoryEntry>
        const track = safeHistoryTrack(entry.track)
        return track && typeof entry.playedAt === 'number' && Number.isFinite(entry.playedAt)
          ? [{ track, playedAt: entry.playedAt }]
          : []
      })
      .sort((left, right) => right.playedAt - left.playedAt)
      .filter(({ track }) => {
        if (seen.has(track.id)) return false
        seen.add(track.id)
        return true
      })
      .slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

function writeHistoryEntries(entries: ListeningHistoryEntry[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // History is a convenience; playback must keep working when storage is blocked or full.
  }
}

function safePlaybackTrack(value: unknown): Track | undefined {
  const track = safeHistoryTrack(value)
  if (!track || !value || typeof value !== 'object') return track
  const streamUrl = (value as Partial<Track>).streamUrl
  return typeof streamUrl === 'string' && isPublicStreamUrl(streamUrl) ? { ...track, streamUrl } : track
}

function isPublicStreamUrl(streamUrl?: string): boolean {
  return Boolean(
    streamUrl?.startsWith('/api/shares/')
    || streamUrl?.startsWith('/api/public-search/')
    || streamUrl?.startsWith('/api/profiles/'),
  )
}

function safePlaybackSource(value: unknown): PlaybackSource | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<PlaybackSource>
  return typeof candidate.playlistId === 'string' && typeof candidate.playlistTitle === 'string'
    ? { playlistId: candidate.playlistId, playlistTitle: candidate.playlistTitle }
    : undefined
}

function readPlaybackState(): PersistedPlaybackState | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(PLAYER_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : undefined
    if (!parsed || typeof parsed !== 'object') return undefined
    const candidate = parsed as Partial<PersistedPlaybackState>
    if (!Array.isArray(candidate.queue)) return undefined
    const queue = candidate.queue.flatMap((value): Track[] => {
      const track = safePlaybackTrack(value)
      return track ? [track] : []
    }).slice(0, QUEUE_STORAGE_LIMIT)
    if (!queue.length || typeof candidate.currentIndex !== 'number' || !Number.isInteger(candidate.currentIndex)) return undefined
    const currentIndex = Math.max(0, Math.min(candidate.currentIndex, queue.length - 1))
    const duration = queue[currentIndex].durationMs / 1000
    const progress = typeof candidate.progress === 'number' && Number.isFinite(candidate.progress)
      ? Math.max(0, Math.min(candidate.progress, duration))
      : 0
    const volume = typeof candidate.volume === 'number' && Number.isFinite(candidate.volume)
      ? Math.max(0, Math.min(candidate.volume, 1))
      : .74
    return {
      queue,
      currentIndex,
      progress,
      volume,
      shuffle: candidate.shuffle === true,
      repeat: candidate.repeat === true,
      playbackSource: safePlaybackSource(candidate.playbackSource),
    }
  } catch {
    return undefined
  }
}

function writePlaybackState(state?: PersistedPlaybackState) {
  if (typeof window === 'undefined') return
  try {
    if (!state?.queue.length) {
      window.localStorage.removeItem(PLAYER_STORAGE_KEY)
      return
    }
    const queue = state.queue.flatMap((value): Track[] => {
      const track = safePlaybackTrack(value)
      return track ? [track] : []
    }).slice(0, QUEUE_STORAGE_LIMIT)
    if (!queue.length) {
      window.localStorage.removeItem(PLAYER_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify({ ...state, queue }))
  } catch {
    // Playback persistence is optional; storage failures must not interrupt audio.
  }
}

function resolveTrackIndex(items: Track[], track: Track, preferredIndex?: number) {
  if (
    preferredIndex !== undefined
    && preferredIndex >= 0
    && preferredIndex < items.length
    && items[preferredIndex].id === track.id
  ) return preferredIndex
  const referenceIndex = items.findIndex((item) => item === track)
  return referenceIndex >= 0 ? referenceIndex : items.findIndex((item) => item.id === track.id)
}

function normalizeQueue(items: Track[]) {
  const seen = new Set<Track>()
  let changed = false
  const normalized = items.map((track) => {
    if (!seen.has(track)) {
      seen.add(track)
      return track
    }
    changed = true
    return { ...track }
  })
  return changed ? normalized : items
}

function streamUrl(track: Track) {
  return track.streamUrl || `/api/tracks/${encodeURIComponent(track.id)}/stream`
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [restoredPlayback] = useState(readPlaybackState)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const nextRef = useRef<() => void>(() => undefined)
  const repeatRef = useRef(false)
  const presenceActiveRef = useRef(false)
  const recordedSelectionRef = useRef<number>(-1)
  const pendingSeekRef = useRef<number | null>(restoredPlayback?.progress ?? null)
  const playbackSnapshotRef = useRef<PersistedPlaybackState | undefined>(undefined)
  const [current, setCurrent] = useState<Track | undefined>(() => restoredPlayback?.queue[restoredPlayback.currentIndex])
  const [currentIndex, setCurrentIndex] = useState(() => restoredPlayback?.currentIndex ?? -1)
  const [queue, setQueue] = useState<Track[]>(() => restoredPlayback?.queue ?? [])
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource | undefined>(() => restoredPlayback?.playbackSource)
  const [historyEntries, setHistoryEntries] = useState<ListeningHistoryEntry[]>(readHistoryEntries)
  const [trackLikes, setTrackLikes] = useState<Record<string, boolean>>({})
  const [selectionVersion, setSelectionVersion] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(() => restoredPlayback?.progress ?? 0)
  const [duration, setDuration] = useState(() => current ? current.durationMs / 1000 : 0)
  const [volume, setVolumeState] = useState(() => restoredPlayback?.volume ?? .74)
  const [shuffle, setShuffle] = useState(() => restoredPlayback?.shuffle ?? false)
  const [repeat, setRepeat] = useState(() => restoredPlayback?.repeat ?? false)

  const clearDemoTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  const selectTrackAt = useCallback((items: Track[], index: number) => {
    const track = items[index]
    if (!track) return
    pendingSeekRef.current = null
    setCurrentIndex(index)
    setCurrent(track)
    setProgress(0)
    setDuration(track.durationMs / 1000)
    setIsPlaying(true)
    setSelectionVersion((value) => value + 1)
  }, [])

  const next = useCallback(() => {
    if (!current || queue.length === 0 || currentIndex < 0) return
    let nextIndex = (currentIndex + 1) % queue.length
    if (shuffle && queue.length > 1) {
      const offset = 1 + Math.min(queue.length - 2, Math.floor(Math.random() * (queue.length - 1)))
      nextIndex = (currentIndex + offset) % queue.length
    }
    selectTrackAt(queue, nextIndex)
  }, [current, currentIndex, queue, selectTrackAt, shuffle])

  const previous = useCallback(() => {
    if (!current || queue.length === 0 || currentIndex < 0) return
    if (progress > 4) {
      setProgress(0)
      if (audioRef.current) audioRef.current.currentTime = 0
      return
    }
    const previousIndex = (currentIndex - 1 + queue.length) % queue.length
    selectTrackAt(queue, previousIndex)
  }, [current, currentIndex, progress, queue, selectTrackAt])

  useEffect(() => {
    nextRef.current = next
    repeatRef.current = repeat
  }, [next, repeat])

  useEffect(() => {
    const clearPresenceOnExit = () => {
      if (!presenceActiveRef.current) return
      void fetch('/api/presence/now-playing', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => undefined)
    }
    window.addEventListener('pagehide', clearPresenceOnExit)
    return () => window.removeEventListener('pagehide', clearPresenceOnExit)
  }, [])

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.volume = volume
    audioRef.current = audio
    const update = () => {
      setProgress(audio.currentTime || 0)
      if (Number.isFinite(audio.duration)) setDuration(audio.duration)
    }
    const loaded = () => {
      if (pendingSeekRef.current !== null) {
        const limit = Number.isFinite(audio.duration) ? audio.duration : pendingSeekRef.current
        audio.currentTime = Math.max(0, Math.min(pendingSeekRef.current, limit))
        pendingSeekRef.current = null
      }
      update()
    }
    const ended = () => {
      if (repeatRef.current) {
        audio.currentTime = 0
        void audio.play()
      } else nextRef.current()
    }
    audio.addEventListener('timeupdate', update)
    audio.addEventListener('loadedmetadata', loaded)
    audio.addEventListener('ended', ended)
    return () => {
      audio.pause()
      audio.removeEventListener('timeupdate', update)
      audio.removeEventListener('loadedmetadata', loaded)
      audio.removeEventListener('ended', ended)
      clearDemoTimer()
    }
  }, [clearDemoTimer])

  useEffect(() => {
    writeHistoryEntries(historyEntries)
  }, [historyEntries])

  playbackSnapshotRef.current = current && currentIndex >= 0 && queue.length ? {
    queue,
    currentIndex,
    progress,
    volume,
    shuffle,
    repeat,
    playbackSource,
  } : undefined

  const persistedProgressSecond = Math.floor(progress)
  useEffect(() => {
    writePlaybackState(playbackSnapshotRef.current)
  }, [current?.id, currentIndex, persistedProgressSecond, playbackSource, queue, repeat, shuffle, volume])

  useEffect(() => {
    const persist = () => writePlaybackState(playbackSnapshotRef.current)
    window.addEventListener('pagehide', persist)
    return () => window.removeEventListener('pagehide', persist)
  }, [])

  useEffect(() => {
    if (!current || selectionVersion === 0) return
    const track = safeHistoryTrack(current)
    if (!track) return
    const entry = { track, playedAt: Date.now() }
    setHistoryEntries((items) => [entry, ...items.filter((item) => item.track.id !== track.id)].slice(0, HISTORY_LIMIT))
  }, [current?.id, selectionVersion])

  useEffect(() => {
    if (!current || !isPlaying || recordedSelectionRef.current === selectionVersion) return
    if (current.id.startsWith('demo-') || isPublicStreamUrl(current.streamUrl)) return
    const timeout = window.setTimeout(() => {
      recordedSelectionRef.current = selectionVersion
      void recordListeningEvent(current, 20_000).catch(() => undefined)
    }, 20_000)
    return () => window.clearTimeout(timeout)
  }, [current, isPlaying, selectionVersion])

  useEffect(() => {
    if (!current || !isPlaying || current.id.startsWith('demo-') || isPublicStreamUrl(current.streamUrl)) {
      if (presenceActiveRef.current) {
        presenceActiveRef.current = false
        void clearNowPlaying().catch(() => undefined)
      }
      return
    }
    presenceActiveRef.current = true
    const heartbeat = () => void updateNowPlaying(current, playbackSource?.playlistId).catch(() => undefined)
    heartbeat()
    const interval = window.setInterval(heartbeat, 15_000)
    return () => window.clearInterval(interval)
  }, [current, isPlaying, playbackSource?.playlistId, selectionVersion])

  useEffect(() => {
    const audio = audioRef.current
    if (!current || !audio) return
    setDuration(current.durationMs / 1000)
    setProgress(selectionVersion === 0 && pendingSeekRef.current !== null ? pendingSeekRef.current : 0)
    clearDemoTimer()
    if (current.id.startsWith('demo-')) {
      audio.pause()
      return
    }
    audio.src = streamUrl(current)
    audio.load()
  }, [clearDemoTimer, current?.id, selectionVersion])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !current) return
    clearDemoTimer()
    if (current.id.startsWith('demo-')) {
      audio.pause()
      if (isPlaying) {
        timerRef.current = window.setInterval(() => {
          setProgress((value) => {
            const limit = current.durationMs / 1000
            if (value + 1 >= limit) {
              window.setTimeout(() => nextRef.current(), 0)
              return 0
            }
            return value + 1
          })
        }, 1000)
      }
      return clearDemoTimer
    }
    if (isPlaying) void audio.play().catch(() => setIsPlaying(false))
    else audio.pause()
    return undefined
  }, [clearDemoTimer, current?.id, isPlaying, selectionVersion])

  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artists.join(', '),
      album: current.album,
      artwork: current.coverUrl ? [{ src: current.coverUrl.replace('%%', '400x400') }] : [],
    })
    navigator.mediaSession.setActionHandler('play', () => setIsPlaying(true))
    navigator.mediaSession.setActionHandler('pause', () => setIsPlaying(false))
    navigator.mediaSession.setActionHandler('nexttrack', next)
    navigator.mediaSession.setActionHandler('previoustrack', previous)
  }, [current, next, previous])

  const playTrack = useCallback((track: Track, context: Track[] = [track], startIndex?: number, source?: PlaybackSource) => {
    let tracks = normalizeQueue(context.length ? context : [track])
    let index = resolveTrackIndex(tracks, track, startIndex)
    if (index < 0) {
      tracks = [track, ...tracks]
      index = 0
    }
    setQueue(tracks)
    setPlaybackSource(source)
    trackGoal('music_play', { source: source ? 'playlist' : 'track', queueSize: tracks.length })
    if (source) trackGoal('playlist_play', { source: 'xedoc', queueSize: tracks.length })
    selectTrackAt(tracks, index)
  }, [selectTrackAt])

  const playQueue = useCallback((tracks: Track[], startIndex = 0, source?: PlaybackSource) => {
    if (!tracks.length) return
    const normalized = normalizeQueue(tracks)
    const index = Math.max(0, Math.min(Math.trunc(startIndex), normalized.length - 1))
    setQueue(normalized)
    setPlaybackSource(source)
    trackGoal('music_play', { source: source ? 'playlist' : 'collection', queueSize: normalized.length })
    if (source) trackGoal('playlist_play', { source: 'xedoc', queueSize: normalized.length })
    selectTrackAt(normalized, index)
  }, [selectTrackAt])

  const togglePlayback = useCallback(() => {
    if (!current) {
      if (queue.length) selectTrackAt(queue, 0)
      return
    }
    if (!isPlaying) trackGoal('music_resume', { source: playbackSource ? 'playlist' : 'player' })
    setIsPlaying((value) => !value)
  }, [current, isPlaying, playbackSource, queue, selectTrackAt])

  const seek = useCallback((seconds: number) => {
    const value = Math.max(0, Math.min(seconds, duration || 0))
    pendingSeekRef.current = null
    setProgress(value)
    if (audioRef.current && current && !current.id.startsWith('demo-')) audioRef.current.currentTime = value
  }, [current, duration])

  const changeVolume = useCallback((value: number) => {
    const normalized = Math.max(0, Math.min(value, 1))
    setVolumeState(normalized)
    if (audioRef.current) audioRef.current.volume = normalized
  }, [])

  const addNext = useCallback((track: Track) => {
    setQueue((items) => {
      const copy = [...items]
      copy.splice(currentIndex >= 0 ? currentIndex + 1 : 0, 0, items.includes(track) ? { ...track } : track)
      return copy
    })
  }, [currentIndex])

  const applyTrackLike = useCallback((trackId: string, liked: boolean) => {
    setTrackLikes((items) => ({ ...items, [trackId]: liked }))
    setCurrent((track) => track?.id === trackId ? { ...track, liked } : track)
    setQueue((items) => items.map((track) => track.id === trackId ? { ...track, liked } : track))
    setHistoryEntries((items) => items.map((entry) => entry.track.id === trackId
      ? { ...entry, track: { ...entry.track, liked } }
      : entry))
  }, [])

  const isTrackLiked = useCallback((track: Track) => (
    Object.prototype.hasOwnProperty.call(trackLikes, track.id) ? trackLikes[track.id] : Boolean(track.liked)
  ), [trackLikes])

  const setTrackLiked = useCallback(async (track: Track, liked: boolean) => {
    const previous = isTrackLiked(track)
    applyTrackLike(track.id, liked)
    if (track.id.startsWith('demo-')) {
      trackGoal(liked ? 'track_like' : 'track_unlike', { source: 'demo' })
      return
    }
    try {
      await persistTrackLike(track.id, liked)
      trackGoal(liked ? 'track_like' : 'track_unlike', { source: 'catalog' })
    } catch (error) {
      applyTrackLike(track.id, previous)
      throw error
    }
  }, [applyTrackLike, isTrackLiked])

  const clear = useCallback(() => {
    clearDemoTimer()
    pendingSeekRef.current = null
    writePlaybackState()
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setCurrent(undefined)
    setCurrentIndex(-1)
    setQueue([])
    setPlaybackSource(undefined)
    setIsPlaying(false)
    setProgress(0)
    setDuration(0)
    setTrackLikes({})
    setHistoryEntries([])
  }, [clearDemoTimer])

  const upNext = useMemo(() => {
    if (!queue.length) return []
    if (currentIndex < 0 || currentIndex >= queue.length) return queue
    return [...queue.slice(currentIndex + 1), ...queue.slice(0, currentIndex)]
  }, [currentIndex, queue])

  const history = useMemo(() => historyEntries.map((entry) => entry.track), [historyEntries])

  const value = useMemo<PlayerContextValue>(() => ({
    current,
    currentIndex,
    queue,
    upNext,
    history,
    historyEntries,
    isPlaying,
    progress,
    duration,
    volume,
    shuffle,
    repeat,
    playTrack,
    playQueue,
    togglePlayback,
    next,
    previous,
    seek,
    setVolume: changeVolume,
    toggleShuffle: () => setShuffle((value) => !value),
    toggleRepeat: () => setRepeat((value) => !value),
    addNext,
    isTrackLiked,
    setTrackLiked,
    clear,
  }), [addNext, changeVolume, clear, current, currentIndex, duration, history, historyEntries, isPlaying, isTrackLiked, next, playQueue, playTrack, previous, progress, queue, repeat, seek, setTrackLiked, shuffle, togglePlayback, upNext, volume])

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer() {
  const value = useContext(PlayerContext)
  if (!value) throw new Error('usePlayer must be used inside PlayerProvider')
  return value
}
