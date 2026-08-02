export type CoverTone = 'lime' | 'violet' | 'coral' | 'blue' | 'amber' | 'mono'

export interface Track {
  id: string
  title: string
  artists: string[]
  album?: string
  durationMs: number
  coverUrl?: string
  coverTone?: CoverTone
  liked?: boolean
  explicit?: boolean
  streamUrl?: string
}

export interface Playlist {
  id: string
  title: string
  subtitle?: string
  trackCount: number
  durationMinutes?: number
  coverUrl?: string
  coverTone?: CoverTone
  accent?: string
  tracks?: Track[]
  description?: string
  local?: boolean
}

export interface UserProfile {
  name: string
  avatarUrl?: string
}

export interface BootstrapPayload {
  connected: boolean
  demo: boolean
  accessLocked: boolean
  user?: UserProfile
  quickTracks: Track[]
  likedTracks: Track[]
  likedCount: number
  playlists: Playlist[]
  recommendations: Playlist[]
  rediscover: Track[]
  localPlaylists: Playlist[]
  xedocRecommendations: Track[]
  recommendationInsight?: string
}

export interface SearchPayload {
  tracks: Track[]
  playlists: Playlist[]
}

export interface ShareLink {
  token: string
  path: string
}

export interface PublicShare {
  token: string
  kind: 'track' | 'playlist'
  sharedBy: string
  createdAt: number
  track?: Track
  playlist?: Playlist
}

export interface DeviceAuthStart {
  deviceId: string
  userCode: string
  verificationUrl: string
  expiresIn: number
  interval: number
}

export type ViewId = 'home' | 'discover' | 'library' | 'liked' | 'history'

export interface SessionPreferences {
  duration: 25 | 50 | 90
  discovery: number
  cooldownDays: 7 | 30 | 90
  source: 'all' | 'liked' | 'playlists'
  excludeTrackIds?: string[]
}
