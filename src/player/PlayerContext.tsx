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
  playbackSource?: PlaybackSource
  isRemotePlayback: boolean
  playTrack: (track: Track, context?: Track[], startIndex?: number, source?: PlaybackSource) => void
  playQueue: (tracks: Track[], startIndex?: number, source?: PlaybackSource, startAtSeconds?: number) => void
  togglePlayback: () => void
  next: () => void
  previous: () => void
  seek: (seconds: number) => void
  setVolume: (value: number) => void
  toggleShuffle: () => void
  toggleRepeat: () => void
  addNext: (track: Track) => void
  removeFromQueue: (track: Track) => void
  isTrackLiked: (track: Track) => boolean
  setTrackLiked: (track: Track, liked: boolean) => Promise<void>
  clear: () => void
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

const HISTORY_STORAGE_KEY = 'xedoc-play-history-v1'
const PLAYER_STORAGE_KEY = 'xedoc-player-state-v1'
const PLAYBACK_FOCUS_CHANNEL = 'xedoc-playback-focus-v1'
const PLAYBACK_FOCUS_STORAGE_KEY = 'xedoc-playback-focus-v1'
const PLAYBACK_SYNC_CHANNEL = 'xedoc-playback-sync-v1'
const PLAYBACK_SYNC_STATE_STORAGE_KEY = 'xedoc-playback-sync-state-v1'
const PLAYBACK_SYNC_EVENT_STORAGE_KEY = 'xedoc-playback-sync-event-v1'
const PLAYBACK_SYNC_MAX_AGE_MS = 15_000
const HISTORY_LIMIT = 50
const QUEUE_STORAGE_LIMIT = 300
const coverTones = new Set(['lime', 'violet', 'coral', 'blue', 'amber', 'mono'])

interface PlaybackFocusClaim {
  type: 'playing'
  sourceId: string
  claimedAt: number
}

interface PersistedPlaybackState {
  queue: Track[]
  currentIndex: number
  progress: number
  volume: number
  shuffle: boolean
  repeat: boolean
  playbackSource?: PlaybackSource
}

interface PlaybackSyncStateMessage {
  type: 'state'
  sourceId: string
  updatedAt: number
  isPlaying: boolean
  state: PersistedPlaybackState
}

interface PlaybackSyncRequestMessage {
  type: 'request'
  sourceId: string
  requestedAt: number
}

interface PlaybackSyncCommandMessage {
  type: 'command'
  sourceId: string
  targetId: string
  command: 'pause' | 'seek' | 'volume'
  value?: number
  issuedAt: number
}

type PlaybackSyncMessage = PlaybackSyncStateMessage | PlaybackSyncRequestMessage | PlaybackSyncCommandMessage

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

function safePlaybackState(value: unknown): PersistedPlaybackState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<PersistedPlaybackState>
  if (!Array.isArray(candidate.queue)) return undefined
  const queue = candidate.queue.flatMap((item): Track[] => {
    const track = safePlaybackTrack(item)
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
}

function readPlaybackState(): PersistedPlaybackState | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(PLAYER_STORAGE_KEY)
    return safePlaybackState(raw ? JSON.parse(raw) : undefined)
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

function playbackFocusClaim(value: unknown): PlaybackFocusClaim | undefined {
  if (!value || typeof value !== 'object') return undefined
  const claim = value as Partial<PlaybackFocusClaim>
  if (claim.type !== 'playing' || typeof claim.sourceId !== 'string' || typeof claim.claimedAt !== 'number' || !Number.isFinite(claim.claimedAt)) return undefined
  return { type: 'playing', sourceId: claim.sourceId, claimedAt: claim.claimedAt }
}

function isNewerPlaybackFocus(candidate: PlaybackFocusClaim, current: PlaybackFocusClaim) {
  return candidate.claimedAt > current.claimedAt
    || (candidate.claimedAt === current.claimedAt && candidate.sourceId > current.sourceId)
}

function playbackFocusNow() {
  const value = typeof performance !== 'undefined' ? performance.timeOrigin + performance.now() : Date.now()
  return Number.isFinite(value) ? value : Date.now()
}

function playbackSyncMessage(value: unknown): PlaybackSyncMessage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<PlaybackSyncMessage>
  if (typeof candidate.sourceId !== 'string') return undefined
  if (candidate.type === 'state') {
    const state = safePlaybackState(candidate.state)
    return state
      && typeof candidate.updatedAt === 'number'
      && Number.isFinite(candidate.updatedAt)
      && typeof candidate.isPlaying === 'boolean'
      ? { type: 'state', sourceId: candidate.sourceId, updatedAt: candidate.updatedAt, isPlaying: candidate.isPlaying, state }
      : undefined
  }
  if (candidate.type === 'request') {
    return typeof candidate.requestedAt === 'number' && Number.isFinite(candidate.requestedAt)
      ? { type: 'request', sourceId: candidate.sourceId, requestedAt: candidate.requestedAt }
      : undefined
  }
  if (candidate.type === 'command') {
    if (
      typeof candidate.targetId !== 'string'
      || (candidate.command !== 'pause' && candidate.command !== 'seek' && candidate.command !== 'volume')
      || typeof candidate.issuedAt !== 'number'
      || !Number.isFinite(candidate.issuedAt)
      || (candidate.command !== 'pause' && (typeof candidate.value !== 'number' || !Number.isFinite(candidate.value)))
    ) return undefined
    return {
      type: 'command',
      sourceId: candidate.sourceId,
      targetId: candidate.targetId,
      command: candidate.command,
      ...(candidate.command === 'pause' ? {} : { value: candidate.value }),
      issuedAt: candidate.issuedAt,
    }
  }
  return undefined
}

function samePlaybackQueue(left: Track[], right: Track[]) {
  return left.length === right.length && left.every((track, index) => {
    const candidate = right[index]
    return track.id === candidate.id
      && track.title === candidate.title
      && track.durationMs === candidate.durationMs
      && track.streamUrl === candidate.streamUrl
      && track.album === candidate.album
      && track.coverUrl === candidate.coverUrl
      && track.coverTone === candidate.coverTone
      && track.liked === candidate.liked
      && track.explicit === candidate.explicit
      && track.artists.join('\u0000') === candidate.artists.join('\u0000')
  })
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [restoredPlayback] = useState(readPlaybackState)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const nextRef = useRef<() => void>(() => undefined)
  const repeatRef = useRef(false)
  const presenceActiveRef = useRef(false)
  const mediaSessionActiveRef = useRef(false)
  const recordedSelectionRef = useRef<number>(-1)
  const playbackChannelRef = useRef<BroadcastChannel | null>(null)
  const playbackSyncChannelRef = useRef<BroadcastChannel | null>(null)
  const playbackTabIdRef = useRef(`${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`)
  const lastPlaybackFocusRef = useRef<PlaybackFocusClaim>({ type: 'playing', sourceId: '', claimedAt: 0 })
  const lastPlaybackSyncRef = useRef({ sourceId: '', updatedAt: 0 })
  const lastPublishedSyncAtRef = useRef(0)
  const playbackOwnerRef = useRef<string | undefined>(undefined)
  const pendingSeekRef = useRef<number | null>(restoredPlayback?.progress ?? null)
  const playbackSnapshotRef = useRef<PersistedPlaybackState | undefined>(undefined)
  const [current, setCurrent] = useState<Track | undefined>(() => restoredPlayback?.queue[restoredPlayback.currentIndex])
  const [currentIndex, setCurrentIndex] = useState(() => restoredPlayback?.currentIndex ?? -1)
  const [queue, setQueue] = useState<Track[]>(() => restoredPlayback?.queue ?? [])
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource | undefined>(() => restoredPlayback?.playbackSource)
  const [playbackOwnerId, setPlaybackOwnerId] = useState<string | undefined>(undefined)
  const [historyEntries, setHistoryEntries] = useState<ListeningHistoryEntry[]>(readHistoryEntries)
  const [trackLikes, setTrackLikes] = useState<Record<string, boolean>>({})
  const [selectionVersion, setSelectionVersion] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(() => restoredPlayback?.progress ?? 0)
  const [duration, setDuration] = useState(() => current ? current.durationMs / 1000 : 0)
  const [volume, setVolumeState] = useState(() => restoredPlayback?.volume ?? .74)
  const [shuffle, setShuffle] = useState(() => restoredPlayback?.shuffle ?? false)
  const [repeat, setRepeat] = useState(() => restoredPlayback?.repeat ?? false)
  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying
  const isRemotePlayback = Boolean(playbackOwnerId && playbackOwnerId !== playbackTabIdRef.current)

  const setPlaybackOwner = useCallback((sourceId?: string) => {
    playbackOwnerRef.current = sourceId
    setPlaybackOwnerId(sourceId)
  }, [])

  const clearDemoTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  const sendPlaybackSyncMessage = useCallback((message: PlaybackSyncMessage) => {
    try {
      playbackSyncChannelRef.current?.postMessage(message)
    } catch {
      // The storage event below remains available when BroadcastChannel closes unexpectedly.
    }
    try {
      const key = message.type === 'state' ? PLAYBACK_SYNC_STATE_STORAGE_KEY : PLAYBACK_SYNC_EVENT_STORAGE_KEY
      window.localStorage.setItem(key, JSON.stringify(message))
    } catch {
      // Cross-tab state is best-effort when browser storage is unavailable.
    }
  }, [])

  const publishPlaybackState = useCallback((playing = isPlayingRef.current) => {
    const state = playbackSnapshotRef.current
    if (!state) return
    const updatedAt = Math.max(playbackFocusNow(), lastPublishedSyncAtRef.current + 1)
    lastPublishedSyncAtRef.current = updatedAt
    sendPlaybackSyncMessage({
      type: 'state',
      sourceId: playbackTabIdRef.current,
      updatedAt,
      isPlaying: playing,
      state,
    })
  }, [sendPlaybackSyncMessage])

  const pauseRemotePlayback = useCallback(() => {
    const targetId = playbackOwnerRef.current
    if (!targetId || targetId === playbackTabIdRef.current) return false
    sendPlaybackSyncMessage({
      type: 'command',
      sourceId: playbackTabIdRef.current,
      targetId,
      command: 'pause',
      issuedAt: playbackFocusNow(),
    })
    isPlayingRef.current = false
    setIsPlaying(false)
    return true
  }, [sendPlaybackSyncMessage])

  const claimPlaybackFocus = useCallback(() => {
    const previous = lastPlaybackFocusRef.current
    const claim: PlaybackFocusClaim = {
      type: 'playing',
      sourceId: playbackTabIdRef.current,
      claimedAt: Math.max(playbackFocusNow(), previous.claimedAt + 1),
    }
    lastPlaybackFocusRef.current = claim
    try {
      playbackChannelRef.current?.postMessage(claim)
    } catch {
      // The storage event below remains available when BroadcastChannel closes unexpectedly.
    }
    try {
      window.localStorage.setItem(PLAYBACK_FOCUS_STORAGE_KEY, JSON.stringify(claim))
    } catch {
      // Cross-tab focus is best-effort when the browser blocks both communication mechanisms.
    }
  }, [])

  useEffect(() => {
    const acceptClaim = (value: unknown) => {
      const claim = playbackFocusClaim(value)
      if (!claim || claim.sourceId === playbackTabIdRef.current || !isNewerPlaybackFocus(claim, lastPlaybackFocusRef.current)) return
      lastPlaybackFocusRef.current = claim
      clearDemoTimer()
      audioRef.current?.pause()
      setPlaybackOwner(claim.sourceId)
      isPlayingRef.current = false
      setIsPlaying(false)
    }

    let channel: BroadcastChannel | undefined
    try {
      channel = new BroadcastChannel(PLAYBACK_FOCUS_CHANNEL)
      playbackChannelRef.current = channel
      channel.addEventListener('message', (event) => acceptClaim(event.data))
    } catch {
      playbackChannelRef.current = null
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== PLAYBACK_FOCUS_STORAGE_KEY || !event.newValue) return
      try {
        acceptClaim(JSON.parse(event.newValue))
      } catch {
        // Ignore malformed or unrelated values.
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      playbackChannelRef.current = null
      channel?.close()
    }
  }, [clearDemoTimer, setPlaybackOwner])

  useEffect(() => {
    const acceptSyncMessage = (value: unknown, allowStoredState = false) => {
      const message = playbackSyncMessage(value)
      if (!message || message.sourceId === playbackTabIdRef.current) return
      if (message.type === 'request') {
        if (playbackOwnerRef.current === playbackTabIdRef.current) publishPlaybackState()
        return
      }
      if (message.type === 'command') {
        if (message.targetId !== playbackTabIdRef.current || playbackOwnerRef.current !== playbackTabIdRef.current) return
        if (message.command === 'pause') {
          clearDemoTimer()
          audioRef.current?.pause()
          isPlayingRef.current = false
          setIsPlaying(false)
          return
        }
        if (message.command === 'seek') {
          const requested = Math.max(0, message.value || 0)
          const audio = audioRef.current
          const limit = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : requested
          const value = Math.min(requested, limit)
          pendingSeekRef.current = null
          setProgress(value)
          if (audio) {
            try {
              audio.currentTime = value
            } catch {
              pendingSeekRef.current = value
            }
          }
          return
        }
        const value = Math.max(0, Math.min(message.value || 0, 1))
        setVolumeState(value)
        if (audioRef.current) audioRef.current.volume = value
        return
      }
      if (allowStoredState && playbackFocusNow() - message.updatedAt > PLAYBACK_SYNC_MAX_AGE_MS) return
      const lastSync = lastPlaybackSyncRef.current
      if (message.updatedAt < lastSync.updatedAt || (message.updatedAt === lastSync.updatedAt && message.sourceId <= lastSync.sourceId)) return
      lastPlaybackSyncRef.current = { sourceId: message.sourceId, updatedAt: message.updatedAt }
      const remoteCurrent = message.state.queue[message.state.currentIndex]
      if (!remoteCurrent) return
      clearDemoTimer()
      audioRef.current?.pause()
      pendingSeekRef.current = message.state.progress
      setPlaybackOwner(message.sourceId)
      setQueue((items) => samePlaybackQueue(items, message.state.queue) ? items : message.state.queue)
      setCurrent((track) => track && samePlaybackQueue([track], [remoteCurrent]) ? track : remoteCurrent)
      setCurrentIndex(message.state.currentIndex)
      setProgress(message.state.progress)
      setDuration(remoteCurrent.durationMs / 1000)
      setVolumeState(message.state.volume)
      setShuffle(message.state.shuffle)
      setRepeat(message.state.repeat)
      setPlaybackSource((source) => (
        source?.playlistId === message.state.playbackSource?.playlistId
        && source?.playlistTitle === message.state.playbackSource?.playlistTitle
          ? source
          : message.state.playbackSource
      ))
      isPlayingRef.current = message.isPlaying
      setIsPlaying(message.isPlaying)
    }

    let channel: BroadcastChannel | undefined
    try {
      channel = new BroadcastChannel(PLAYBACK_SYNC_CHANNEL)
      playbackSyncChannelRef.current = channel
      channel.addEventListener('message', (event) => acceptSyncMessage(event.data))
    } catch {
      playbackSyncChannelRef.current = null
    }

    const onStorage = (event: StorageEvent) => {
      if ((event.key !== PLAYBACK_SYNC_STATE_STORAGE_KEY && event.key !== PLAYBACK_SYNC_EVENT_STORAGE_KEY) || !event.newValue) return
      try {
        acceptSyncMessage(JSON.parse(event.newValue), event.key === PLAYBACK_SYNC_STATE_STORAGE_KEY)
      } catch {
        // Ignore malformed or unrelated values.
      }
    }
    window.addEventListener('storage', onStorage)

    try {
      const stored = window.localStorage.getItem(PLAYBACK_SYNC_STATE_STORAGE_KEY)
      if (stored) acceptSyncMessage(JSON.parse(stored), true)
    } catch {
      // A live request below can still obtain the active state.
    }
    sendPlaybackSyncMessage({
      type: 'request',
      sourceId: playbackTabIdRef.current,
      requestedAt: playbackFocusNow(),
    })

    const stopOwnedPlayback = () => {
      if (playbackOwnerRef.current === playbackTabIdRef.current && isPlayingRef.current) publishPlaybackState(false)
    }
    window.addEventListener('pagehide', stopOwnedPlayback)
    return () => {
      stopOwnedPlayback()
      window.removeEventListener('pagehide', stopOwnedPlayback)
      window.removeEventListener('storage', onStorage)
      playbackSyncChannelRef.current = null
      channel?.close()
    }
  }, [clearDemoTimer, publishPlaybackState, sendPlaybackSyncMessage, setPlaybackOwner])

  const selectTrackAt = useCallback((items: Track[], index: number, startAtSeconds = 0) => {
    const track = items[index]
    if (!track) return
    const requestedStartAt = Number.isFinite(startAtSeconds) ? startAtSeconds : 0
    const startAt = Math.max(0, Math.min(requestedStartAt, Math.max(0, Math.floor(track.durationMs / 1000) - 1)))
    pendingSeekRef.current = startAt > 0 ? startAt : null
    setCurrentIndex(index)
    setCurrent(track)
    setProgress(startAt)
    setDuration(track.durationMs / 1000)
    setPlaybackOwner(playbackTabIdRef.current)
    isPlayingRef.current = true
    setIsPlaying(true)
    setSelectionVersion((value) => value + 1)
  }, [setPlaybackOwner])

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
    if (playbackOwnerId !== playbackTabIdRef.current || !current) return
    publishPlaybackState(isPlaying)
  }, [current?.id, currentIndex, isPlaying, persistedProgressSecond, playbackOwnerId, playbackSource, publishPlaybackState, queue, repeat, shuffle, volume])

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
    if (!current || !isPlaying || isRemotePlayback || recordedSelectionRef.current === selectionVersion) return
    if (current.id.startsWith('demo-') || isPublicStreamUrl(current.streamUrl)) return
    const timeout = window.setTimeout(() => {
      recordedSelectionRef.current = selectionVersion
      void recordListeningEvent(current, 20_000).catch(() => undefined)
    }, 20_000)
    return () => window.clearTimeout(timeout)
  }, [current, isPlaying, isRemotePlayback, selectionVersion])

  useEffect(() => {
    if (!current || !isPlaying || isRemotePlayback || current.id.startsWith('demo-') || isPublicStreamUrl(current.streamUrl)) {
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
  }, [current, isPlaying, isRemotePlayback, playbackSource?.playlistId, selectionVersion])

  useEffect(() => {
    const audio = audioRef.current
    if (!current || !audio) return
    if (isRemotePlayback || (playbackOwnerRef.current && playbackOwnerRef.current !== playbackTabIdRef.current)) {
      clearDemoTimer()
      audio.pause()
      return
    }
    setDuration(current.durationMs / 1000)
    setProgress(pendingSeekRef.current ?? 0)
    clearDemoTimer()
    if (current.id.startsWith('demo-')) {
      audio.pause()
      return
    }
    audio.src = streamUrl(current)
    audio.load()
  }, [clearDemoTimer, current?.id, isRemotePlayback, selectionVersion])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !current) return
    clearDemoTimer()
    if (isRemotePlayback || (playbackOwnerRef.current && playbackOwnerRef.current !== playbackTabIdRef.current)) {
      audio.pause()
      return
    }
    if (current.id.startsWith('demo-')) {
      audio.pause()
      if (isPlaying && playbackOwnerRef.current === playbackTabIdRef.current) {
        claimPlaybackFocus()
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
    if (isPlaying) void audio.play()
      .then(() => {
        if (isPlayingRef.current && playbackOwnerRef.current === playbackTabIdRef.current && !audio.paused) claimPlaybackFocus()
      })
      .catch(() => {
        isPlayingRef.current = false
        setIsPlaying(false)
      })
    else audio.pause()
    return undefined
  }, [claimPlaybackFocus, clearDemoTimer, current?.id, isPlaying, isRemotePlayback, selectionVersion])

  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return
    const mediaSession = navigator.mediaSession
    if (isRemotePlayback || (playbackOwnerRef.current && playbackOwnerRef.current !== playbackTabIdRef.current)) {
      if (mediaSessionActiveRef.current) {
        mediaSession.metadata = null
        mediaSession.setActionHandler('play', null)
        mediaSession.setActionHandler('pause', null)
        mediaSession.setActionHandler('nexttrack', null)
        mediaSession.setActionHandler('previoustrack', null)
        mediaSessionActiveRef.current = false
      }
      return
    }
    mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artists.join(', '),
      album: current.album,
      artwork: current.coverUrl ? [{ src: current.coverUrl.replace('%%', '400x400') }] : [],
    })
    mediaSession.setActionHandler('play', () => {
      if (playbackOwnerRef.current !== playbackTabIdRef.current) {
        pendingSeekRef.current = progress
        setPlaybackOwner(playbackTabIdRef.current)
        setSelectionVersion((value) => value + 1)
      }
      isPlayingRef.current = true
      setIsPlaying(true)
    })
    mediaSession.setActionHandler('pause', () => {
      if (pauseRemotePlayback()) return
      isPlayingRef.current = false
      setIsPlaying(false)
    })
    mediaSession.setActionHandler('nexttrack', next)
    mediaSession.setActionHandler('previoustrack', previous)
    mediaSessionActiveRef.current = true
  }, [current, isRemotePlayback, next, pauseRemotePlayback, previous, progress, setPlaybackOwner])

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

  const playQueue = useCallback((tracks: Track[], startIndex = 0, source?: PlaybackSource, startAtSeconds = 0) => {
    if (!tracks.length) return
    const normalized = normalizeQueue(tracks)
    const index = Math.max(0, Math.min(Math.trunc(startIndex), normalized.length - 1))
    setQueue(normalized)
    setPlaybackSource(source)
    trackGoal('music_play', { source: source ? 'playlist' : 'collection', queueSize: normalized.length })
    if (source) trackGoal('playlist_play', { source: 'xedoc', queueSize: normalized.length })
    selectTrackAt(normalized, index, startAtSeconds)
  }, [selectTrackAt])

  const togglePlayback = useCallback(() => {
    if (!current) {
      if (queue.length) selectTrackAt(queue, 0)
      return
    }
    if (isPlaying && pauseRemotePlayback()) return
    if (!isPlaying) {
      trackGoal('music_resume', { source: playbackSource ? 'playlist' : 'player' })
      if (playbackOwnerRef.current !== playbackTabIdRef.current) {
        pendingSeekRef.current = progress
        setPlaybackOwner(playbackTabIdRef.current)
        setSelectionVersion((value) => value + 1)
      }
    }
    isPlayingRef.current = !isPlaying
    setIsPlaying(!isPlaying)
  }, [current, isPlaying, pauseRemotePlayback, playbackSource, progress, queue, selectTrackAt, setPlaybackOwner])

  const seek = useCallback((seconds: number) => {
    const value = Math.max(0, Math.min(seconds, duration || 0))
    if (isRemotePlayback) {
      const targetId = playbackOwnerRef.current
      if (!targetId) return
      setProgress(value)
      sendPlaybackSyncMessage({
        type: 'command',
        sourceId: playbackTabIdRef.current,
        targetId,
        command: 'seek',
        value,
        issuedAt: playbackFocusNow(),
      })
      return
    }
    pendingSeekRef.current = null
    setProgress(value)
    if (audioRef.current && current && !current.id.startsWith('demo-')) audioRef.current.currentTime = value
  }, [current, duration, isRemotePlayback, sendPlaybackSyncMessage])

  const changeVolume = useCallback((value: number) => {
    const normalized = Math.max(0, Math.min(value, 1))
    setVolumeState(normalized)
    if (isRemotePlayback) {
      const targetId = playbackOwnerRef.current
      if (!targetId) return
      sendPlaybackSyncMessage({
        type: 'command',
        sourceId: playbackTabIdRef.current,
        targetId,
        command: 'volume',
        value: normalized,
        issuedAt: playbackFocusNow(),
      })
      return
    }
    if (audioRef.current) audioRef.current.volume = normalized
  }, [isRemotePlayback, sendPlaybackSyncMessage])

  const addNext = useCallback((track: Track) => {
    setQueue((items) => {
      const copy = [...items]
      copy.splice(currentIndex >= 0 ? currentIndex + 1 : 0, 0, items.includes(track) ? { ...track } : track)
      return copy
    })
  }, [currentIndex])

  const removeFromQueue = useCallback((track: Track) => {
    const index = queue.indexOf(track)
    if (index < 0 || index === currentIndex) return
    setQueue((items) => items.filter((item) => item !== track))
    setCurrentIndex((value) => index < value ? value - 1 : value)
  }, [currentIndex, queue])

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
      await persistTrackLike(track, liked)
      trackGoal(liked ? 'track_like' : 'track_unlike', { source: 'catalog' })
    } catch (error) {
      applyTrackLike(track.id, previous)
      throw error
    }
  }, [applyTrackLike, isTrackLiked])

  const clear = useCallback(() => {
    if (playbackOwnerRef.current === playbackTabIdRef.current) publishPlaybackState(false)
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
    setPlaybackOwner(undefined)
    isPlayingRef.current = false
    setIsPlaying(false)
    setProgress(0)
    setDuration(0)
    setTrackLikes({})
    setHistoryEntries([])
  }, [clearDemoTimer, publishPlaybackState, setPlaybackOwner])

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
    playbackSource,
    isRemotePlayback,
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
    removeFromQueue,
    isTrackLiked,
    setTrackLiked,
    clear,
  }), [addNext, changeVolume, clear, current, currentIndex, duration, history, historyEntries, isPlaying, isRemotePlayback, isTrackLiked, next, playQueue, playTrack, playbackSource, previous, progress, queue, removeFromQueue, repeat, seek, setTrackLiked, shuffle, togglePlayback, upNext, volume])

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer() {
  const value = useContext(PlayerContext)
  if (!value) throw new Error('usePlayer must be used inside PlayerProvider')
  return value
}
