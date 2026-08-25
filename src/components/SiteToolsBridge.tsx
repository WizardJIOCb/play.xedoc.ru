import { useEffect, useRef } from 'react'
import {
  addTrackToLocalPlaylist,
  buildSession,
  getBootstrap,
  getListeningStats,
  getLocalPlaylists,
  searchMusic,
} from '../lib/api'
import { usePlayer } from '../player/PlayerContext'
import type { Playlist, SessionPreferences, Track } from '../types'

type JsonObject = Record<string, unknown>

export interface WebMcpTool {
  name: string
  description: string
  inputSchema: JsonObject
  annotations?: { readOnlyHint?: boolean }
  execute: (input?: unknown) => unknown | Promise<unknown>
}

interface WebMcpModelContext {
  registerTool: (tool: WebMcpTool) => unknown | Promise<unknown>
}

const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}

const PLAYLISTS_CHANGED_EVENT = 'xedoc:playlists-changed'
const TRACK_CACHE_LIMIT = 1_000

function inputObject(input: unknown): JsonObject {
  if (input === undefined) return {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Аргументы инструмента должны быть объектом')
  return input as JsonObject
}

function requiredString(input: JsonObject, name: string, maximumLength = 256): string {
  const value = input[name]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Параметр ${name} обязателен`)
  const normalized = value.trim()
  if (normalized.length > maximumLength) throw new Error(`Параметр ${name} слишком длинный`)
  return normalized
}

function optionalInteger(input: JsonObject, name: string, fallback: number, minimum: number, maximum: number): number {
  const value = input[name]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Параметр ${name} должен быть целым числом от ${minimum} до ${maximum}`)
  }
  return value
}

function optionalBoolean(input: JsonObject, name: string, fallback: boolean): boolean {
  const value = input[name]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`Параметр ${name} должен быть true или false`)
  return value
}

function optionalEnum<T extends string | number>(input: JsonObject, name: string, values: readonly T[], fallback: T): T {
  const value = input[name]
  if (value === undefined) return fallback
  if (!values.includes(value as T)) throw new Error(`Параметр ${name} имеет недопустимое значение`)
  return value as T
}

function publicTrack(track: Track) {
  return {
    id: track.id,
    title: track.title,
    artists: track.artists,
    durationMs: track.durationMs,
    ...(track.album ? { album: track.album } : {}),
    ...(typeof track.liked === 'boolean' ? { liked: track.liked } : {}),
    ...(typeof track.explicit === 'boolean' ? { explicit: track.explicit } : {}),
    ...(typeof track.playCount === 'number' ? { playCount: track.playCount } : {}),
    ...(typeof track.totalListenedMs === 'number' ? { totalListenedMs: track.totalListenedMs } : {}),
    ...(typeof track.lastPlayedAt === 'number' ? { lastPlayedAt: track.lastPlayedAt } : {}),
  }
}

function publicPlaylist(playlist: Playlist, editable: boolean) {
  return {
    id: playlist.id,
    title: playlist.title,
    trackCount: playlist.trackCount,
    editable,
    ...(playlist.subtitle ? { subtitle: playlist.subtitle } : {}),
    ...(playlist.description ? { description: playlist.description } : {}),
    ...(typeof playlist.durationMinutes === 'number' ? { durationMinutes: playlist.durationMinutes } : {}),
    ...(typeof playlist.isPublic === 'boolean' ? { isPublic: playlist.isPublic } : {}),
  }
}

function getModelContext(): WebMcpModelContext | undefined {
  return (document as Document & { modelContext?: WebMcpModelContext }).modelContext
}

export function SiteToolsBridge() {
  const player = usePlayer()
  const playerRef = useRef(player)
  const trackCacheRef = useRef(new Map<string, Track>())
  const trackContextRef = useRef(new Map<string, Track[]>())
  const registeredRef = useRef(false)
  playerRef.current = player

  const rememberTracks = (tracks: Track[], context: Track[] = tracks) => {
    for (const track of tracks) {
      trackCacheRef.current.delete(track.id)
      trackCacheRef.current.set(track.id, track)
      trackContextRef.current.set(track.id, context)
    }
    while (trackCacheRef.current.size > TRACK_CACHE_LIMIT) {
      const oldest = trackCacheRef.current.keys().next().value as string | undefined
      if (!oldest) break
      trackCacheRef.current.delete(oldest)
      trackContextRef.current.delete(oldest)
    }
  }

  if (player.queue.length) rememberTracks(player.queue, player.queue)
  if (player.current && !player.queue.some((track) => track === player.current)) rememberTracks([player.current])

  const resolveTrack = (trackId: string): Track => {
    const currentPlayer = playerRef.current
    const liveTrack = [currentPlayer.current, ...currentPlayer.queue, ...currentPlayer.history]
      .find((track) => track?.id === trackId)
    const track = liveTrack || trackCacheRef.current.get(trackId)
    if (!track) throw new Error(`Трек ${trackId} неизвестен странице. Сначала вызовите search_music, get_queue или get_listening_stats.`)
    return track
  }

  useEffect(() => {
    const modelContext = getModelContext()
    if (registeredRef.current || typeof modelContext?.registerTool !== 'function') return
    registeredRef.current = true

    const tools: WebMcpTool[] = [
      {
        name: 'search_music',
        description: 'Search the XEDOC Play catalog for tracks, playlists, and profiles. Read-only. Call this before play_track or add_next when you do not already have a track ID.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 200, description: 'Artist, track, album, playlist, or profile query.' },
            limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'Maximum track results to return.' },
          },
          required: ['query'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: async (rawInput) => {
          const input = inputObject(rawInput)
          const query = requiredString(input, 'query', 200)
          const limit = optionalInteger(input, 'limit', 10, 1, 20)
          const result = await searchMusic(query)
          rememberTracks(result.tracks, result.tracks)
          result.playlists.forEach((playlist) => rememberTracks(playlist.tracks || []))
          return {
            query,
            totalTracks: result.tracks.length,
            tracks: result.tracks.slice(0, limit).map(publicTrack),
            playlists: result.playlists.slice(0, 10).map((playlist) => publicPlaylist(playlist, Boolean(playlist.local))),
            profiles: result.profiles.slice(0, 10),
          }
        },
      },
      {
        name: 'get_player_state',
        description: 'Read the current XEDOC Play player state, including active track, playback position, volume, and queue size. Read-only.',
        inputSchema: EMPTY_INPUT_SCHEMA,
        annotations: { readOnlyHint: true },
        execute: () => {
          const currentPlayer = playerRef.current
          if (currentPlayer.queue.length) rememberTracks(currentPlayer.queue, currentPlayer.queue)
          if (currentPlayer.current && !currentPlayer.queue.some((track) => track === currentPlayer.current)) rememberTracks([currentPlayer.current])
          return {
            current: currentPlayer.current ? publicTrack(currentPlayer.current) : null,
            isPlaying: currentPlayer.isPlaying,
            progressSeconds: Math.round(currentPlayer.progress),
            durationSeconds: Math.round(currentPlayer.duration),
            volume: currentPlayer.volume,
            shuffle: currentPlayer.shuffle,
            repeat: currentPlayer.repeat,
            currentIndex: currentPlayer.currentIndex,
            queueLength: currentPlayer.queue.length,
          }
        },
      },
      {
        name: 'get_queue',
        description: 'Read the current XEDOC Play playback queue and identify the active item. Read-only.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50, description: 'Maximum queue items to return.' },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: (rawInput) => {
          const input = inputObject(rawInput)
          const limit = optionalInteger(input, 'limit', 50, 1, 100)
          const currentPlayer = playerRef.current
          rememberTracks(currentPlayer.queue, currentPlayer.queue)
          return {
            currentIndex: currentPlayer.currentIndex,
            totalItems: currentPlayer.queue.length,
            items: currentPlayer.queue.slice(0, limit).map((track, index) => ({
              position: index + 1,
              current: index === currentPlayer.currentIndex,
              ...publicTrack(track),
            })),
          }
        },
      },
      {
        name: 'play_track',
        description: 'Start a known XEDOC Play track and replace the current queue with the track context returned by search or another site tool. This changes playback and may start audio.',
        inputSchema: {
          type: 'object',
          properties: {
            trackId: { type: 'string', minLength: 1, maxLength: 256, description: 'Track ID returned by search_music, get_queue, build_session, or get_listening_stats.' },
          },
          required: ['trackId'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: (rawInput) => {
          const input = inputObject(rawInput)
          const trackId = requiredString(input, 'trackId')
          const track = resolveTrack(trackId)
          const context = trackContextRef.current.get(trackId) || [track]
          const startIndex = Math.max(0, context.findIndex((item) => item.id === trackId))
          playerRef.current.playTrack(track, context, startIndex)
          return {
            status: 'playback_requested',
            track: publicTrack(track),
            queueLength: context.length,
            playbackMayRequireUserGesture: true,
          }
        },
      },
      {
        name: 'add_next',
        description: 'Insert a known track immediately after the current XEDOC Play queue item. This changes the playback queue.',
        inputSchema: {
          type: 'object',
          properties: {
            trackId: { type: 'string', minLength: 1, maxLength: 256, description: 'Track ID returned by another XEDOC Play site tool.' },
          },
          required: ['trackId'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: (rawInput) => {
          const input = inputObject(rawInput)
          const track = resolveTrack(requiredString(input, 'trackId'))
          const currentPlayer = playerRef.current
          currentPlayer.addNext(track)
          return {
            status: 'queued_next',
            track: publicTrack(track),
            expectedPosition: (currentPlayer.currentIndex >= 0 ? currentPlayer.currentIndex + 1 : 0) + 1,
            queueLength: currentPlayer.queue.length + 1,
          }
        },
      },
      {
        name: 'build_session',
        description: 'Build a 25, 50, or 90 minute XEDOC listening session for the signed-in user. By default this replaces the current queue and starts the first track; set startPlayback to false to preview only.',
        inputSchema: {
          type: 'object',
          properties: {
            duration: { type: 'integer', enum: [25, 50, 90], default: 50, description: 'Target session duration in minutes.' },
            discovery: { type: 'integer', minimum: 0, maximum: 100, default: 58, description: 'Percent of discovery versus familiar music.' },
            cooldownDays: { type: 'integer', enum: [7, 30, 90], default: 30, description: 'Exclude tracks heard during this many recent days.' },
            source: { type: 'string', enum: ['all', 'liked', 'playlists'], default: 'all', description: 'Music source for the session.' },
            startPlayback: { type: 'boolean', default: true, description: 'Replace the current queue and start the first track.' },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: async (rawInput) => {
          const input = inputObject(rawInput)
          const duration = optionalEnum(input, 'duration', [25, 50, 90] as const, 50)
          const discovery = optionalInteger(input, 'discovery', 58, 0, 100)
          const cooldownDays = optionalEnum(input, 'cooldownDays', [7, 30, 90] as const, 30)
          const source = optionalEnum(input, 'source', ['all', 'liked', 'playlists'] as const, 'all')
          const startPlayback = optionalBoolean(input, 'startPlayback', true)
          const cutoff = Date.now() - cooldownDays * 24 * 60 * 60 * 1_000
          const excludeTrackIds = playerRef.current.historyEntries
            .filter((entry) => entry.playedAt >= cutoff)
            .map((entry) => entry.track.id)
          const preferences: SessionPreferences = { duration, discovery, cooldownDays, source, excludeTrackIds }
          const bootstrap = await getBootstrap()
          if (!bootstrap.authenticated) throw new Error('Чтобы собирать персональные сессии, войдите в аккаунт XEDOC Play')
          const result = await buildSession(preferences)
          if (!result.tracks.length) throw new Error('XEDOC Play не смог подобрать треки для этих настроек')
          rememberTracks(result.tracks, result.tracks)
          if (startPlayback) playerRef.current.playQueue(result.tracks)
          return {
            status: startPlayback ? 'playback_requested' : 'session_built',
            preferences: { duration, discovery, cooldownDays, source },
            trackCount: result.tracks.length,
            totalDurationMs: result.tracks.reduce((total, track) => total + track.durationMs, 0),
            tracks: result.tracks.map(publicTrack),
            ...(startPlayback ? { playbackMayRequireUserGesture: true } : {}),
          }
        },
      },
      {
        name: 'list_playlists',
        description: 'List playlists available to the current XEDOC Play user and mark which playlists can accept tracks. Read-only.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['all', 'editable'], default: 'all', description: 'Return all playlists or only editable XEDOC playlists.' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50, description: 'Maximum playlists to return.' },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: async (rawInput) => {
          const input = inputObject(rawInput)
          const kind = optionalEnum(input, 'kind', ['all', 'editable'] as const, 'all')
          const limit = optionalInteger(input, 'limit', 50, 1, 100)
          const bootstrap = await getBootstrap()
          if (!bootstrap.authenticated) return {
            authenticated: false,
            totalPlaylists: 0,
            playlists: [],
            message: 'Войдите в аккаунт XEDOC Play, чтобы увидеть личные плейлисты.',
          }
          const localPlaylists = await getLocalPlaylists()
          const editableIds = new Set(localPlaylists.map((playlist) => playlist.id))
          const playlists = [
            ...localPlaylists,
            ...bootstrap.playlists.filter((playlist) => !editableIds.has(playlist.id)),
          ].filter((playlist) => kind === 'all' || editableIds.has(playlist.id))
          playlists.forEach((playlist) => rememberTracks(playlist.tracks || []))
          return {
            authenticated: bootstrap.authenticated,
            totalPlaylists: playlists.length,
            playlists: playlists.slice(0, limit).map((playlist) => publicPlaylist(playlist, editableIds.has(playlist.id))),
          }
        },
      },
      {
        name: 'add_to_playlist',
        description: 'Add a known track to an editable XEDOC playlist owned by the signed-in user. This permanently changes that playlist.',
        inputSchema: {
          type: 'object',
          properties: {
            playlistId: { type: 'string', minLength: 1, maxLength: 256, description: 'Editable playlist ID returned by list_playlists.' },
            trackId: { type: 'string', minLength: 1, maxLength: 256, description: 'Track ID returned by another XEDOC Play site tool.' },
          },
          required: ['playlistId', 'trackId'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: async (rawInput) => {
          const input = inputObject(rawInput)
          const playlistId = requiredString(input, 'playlistId')
          const track = resolveTrack(requiredString(input, 'trackId'))
          const bootstrap = await getBootstrap()
          if (!bootstrap.authenticated) throw new Error('Чтобы менять плейлисты, войдите в аккаунт XEDOC Play')
          const playlists = await getLocalPlaylists()
          const playlist = playlists.find((item) => item.id === playlistId)
          if (!playlist) throw new Error(`Редактируемый плейлист ${playlistId} не найден. Сначала вызовите list_playlists.`)
          const updated = await addTrackToLocalPlaylist(playlistId, track)
          rememberTracks(updated.tracks || [])
          window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT))
          return {
            status: 'track_added',
            track: publicTrack(track),
            playlist: publicPlaylist(updated, true),
          }
        },
      },
      {
        name: 'get_listening_stats',
        description: 'Read personal listening statistics for the signed-in XEDOC Play user, or public service statistics for a guest. Read-only.',
        inputSchema: {
          type: 'object',
          properties: {
            periodDays: { type: 'integer', enum: [1, 3, 7, 30], description: 'Optional period. Omit for all-time statistics.' },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 10, description: 'Maximum top tracks to return.' },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: async (rawInput) => {
          const input = inputObject(rawInput)
          const periodDays = input.periodDays === undefined
            ? undefined
            : optionalEnum(input, 'periodDays', [1, 3, 7, 30] as const, 30)
          const limit = optionalInteger(input, 'limit', 10, 1, 50)
          const [bootstrap, stats] = await Promise.all([getBootstrap(), getListeningStats()])
          const period = stats.top.find((item) => item.periodDays === periodDays)
          if (!period) throw new Error('Статистика за выбранный период недоступна')
          rememberTracks(period.tracks, period.tracks)
          return {
            scope: bootstrap.authenticated ? 'personal' : 'public',
            totalPlays: stats.totalPlays,
            uniqueTracks: stats.uniqueTracks,
            totalListenedMs: stats.totalListenedMs,
            period: {
              id: period.id,
              title: period.title,
              periodDays: period.periodDays ?? null,
              totalPlays: period.totalPlays,
              tracks: period.tracks.slice(0, limit).map(publicTrack),
            },
          }
        },
      },
    ]

    const register = async () => {
      for (const tool of tools) {
        try {
          await modelContext.registerTool(tool)
        } catch (reason) {
          console.warn(`Не удалось зарегистрировать WebMCP-инструмент ${tool.name}`, reason)
        }
      }
    }
    void register()
  }, [])

  return null
}
