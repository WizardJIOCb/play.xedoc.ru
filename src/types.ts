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
  avatarUrl?: string
  needsPassword: boolean
  isAdmin: boolean
}

export interface AdminSummary {
  usersTotal: number
  newUsers7d: number
  activeUsers30d: number
  yandexConnected: number
  playlistsTotal: number
  publicPlaylists: number
  playlistTracks: number
  totalPlays: number
  uniqueTracks: number
  totalListenedMs: number
  publicShares: number
}

export interface AdminUser {
  username: string
  displayName: string
  isAdmin: boolean
  createdAt: number
  yandexConnected: boolean
  playlists: number
  publicPlaylists: number
  playlistTracks: number
  totalPlays: number
  uniqueTracks: number
  totalListenedMs: number
  lastPlayedAt?: number
}

export interface AdminDashboard {
  summary: AdminSummary
  users: AdminUser[]
  topTracks: Track[]
}

export interface BootstrapPayload {
  connected: boolean
  demo: boolean
  catalogAvailable: boolean
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
  avatarUrl?: string
  memberSince: number
  publicPlaylistCount: number
  stats: PublicProfileStats
  topTracks: Track[]
  playlists: Playlist[]
  nowPlaying?: PublicNowPlaying
}

export type SocialAttachment =
  | { kind: 'image'; url: string; title?: string }
  | { kind: 'video'; url: string; title?: string }
  | { kind: 'link'; url: string; title?: string; description?: string; imageUrl?: string }
  | { kind: 'track'; track: Track }
  | { kind: 'playlist'; playlist: Playlist }

export interface SocialPollOption {
  id: string
  text: string
  votes: number
  selected: boolean
}

export interface SocialPoll {
  question: string
  options: SocialPollOption[]
  totalVotes: number
}

export interface SocialPost {
  id: string
  author: { username: string; displayName: string }
  body: string
  visibility: 'public' | 'friends'
  attachments: SocialAttachment[]
  poll?: SocialPoll
  createdAt: number
  likeCount: number
  commentCount: number
  liked: boolean
  isOwner: boolean
  rankingReason?: string
}

export interface GlobalRelease {
  id: string
  title: string
  artists: string[]
  coverUrl?: string
  releaseDate?: string
  genre?: string
  tracks: Track[]
}

export interface GlobalGenre {
  id: string
  title: string
  scope: 'international' | 'russian'
  sourceTitle?: string
  tracks: Track[]
}

export interface GlobalTopPayload {
  generatedAt: number
  editionDate: string
  chartTitle: string
  chartDescription?: string
  chart: Track[]
  releases: GlobalRelease[]
  genres: GlobalGenre[]
}

export interface GlobalTopSection {
  kind: 'chart' | 'releases' | 'genre'
  id: string
  title: string
  description?: string
  total: number
  offset: number
  limit: number
  hasMore: boolean
  tracks: Track[]
  releases: GlobalRelease[]
}

export interface SocialComment {
  id: string
  postId: string
  parentId?: string
  author: { username: string; displayName: string }
  body: string
  createdAt: number
  deleted: boolean
  isOwner: boolean
  replies: SocialComment[]
}

export interface SocialFeed {
  posts: SocialPost[]
  algorithm: string
}

export interface Friend {
  username: string
  displayName: string
  status: 'friend' | 'incoming' | 'outgoing'
}

export interface FriendsPayload {
  friends: Friend[]
  incoming: Friend[]
  outgoing: Friend[]
}

export type FriendStatus = 'self' | 'none' | 'friend' | 'incoming' | 'outgoing'

export interface PublicNowPlaying {
  track: Track
  updatedAt: number
  playlist?: Playlist
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
  reused: number
  processed: number
  matched: number
  unmatched: number
  playlistId?: string
  error?: string
  createdAt: number
  updatedAt: number
}

export type ViewId = 'home' | 'feed' | 'friends' | 'discover' | 'library' | 'liked' | 'history'

export interface SessionPreferences {
  duration: 25 | 50 | 90
  discovery: number
  cooldownDays: 7 | 30 | 90
  source: 'all' | 'liked' | 'playlists'
  excludeTrackIds?: string[]
}
