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
  playCount?: number
  totalListenedMs?: number
  lastPlayedAt?: number
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
  isPublic?: boolean
}

export interface UserProfile {
  name: string
  avatarUrl?: string
}

export interface AppUser {
  id: string
  username: string
  displayName: string
  needsPassword: boolean
}

export interface BootstrapPayload {
  connected: boolean
  demo: boolean
  accessLocked: boolean
  authenticated: boolean
  appUser?: AppUser
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
  xedocCollections: RecommendationCollection[]
}

export interface RecommendationCollection {
  id: string
  title: string
  subtitle: string
  periodDays: 1 | 3 | 7 | 30
  signalCount: number
  fallback: boolean
  tracks: Track[]
}

export interface ListeningTop {
  id: string
  title: string
  periodDays?: 1 | 3 | 7 | 30
  totalPlays: number
  tracks: Track[]
}

export interface ListeningStats {
  totalPlays: number
  uniqueTracks: number
  totalListenedMs: number
  top: ListeningTop[]
}

export interface LikedTracksPayload {
  tracks: Track[]
  total: number
}

export interface DiscoveryRecommendations {
  tracks: Track[]
  seedCount: number
  knownTrackCount: number
  insight: string
}

export interface SearchPayload {
  tracks: Track[]
  playlists: Playlist[]
  profiles: ProfileSummary[]
}

export interface ProfileSummary {
  username: string
  displayName: string
  publicPlaylistCount: number
}

export interface PublicProfileStats {
  totalPlays: number
  uniqueTracks: number
  totalListenedMs: number
}

export interface PublicProfile {
  username: string
  displayName: string
  memberSince: number
  publicPlaylistCount: number
  stats: PublicProfileStats
  topTracks: Track[]
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

export interface VKImportResult {
  playlist: Playlist
  matched: number
  unmatched: Array<{ title: string; artist: string; duration?: string }>
}

export interface VKImportJob {
  id: string
  status: 'queued' | 'running' | 'complete' | 'failed'
  sourceUrl: string
  total: number
  processed: number
  matched: number
  unmatched: number
  playlistId?: string
  error?: string
  createdAt: number
  updatedAt: number
}

export type ViewId = 'home' | 'discover' | 'library' | 'liked' | 'history'

export interface SessionPreferences {
  duration: 25 | 50 | 90
  discovery: number
  cooldownDays: 7 | 30 | 90
  source: 'all' | 'liked' | 'playlists'
  excludeTrackIds?: string[]
}
