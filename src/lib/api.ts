import type { AppUser, BootstrapPayload, DeviceAuthStart, DiscoveryRecommendations, LikedTracksPayload, ListeningStats, Playlist, ProfileSummary, PublicProfile, PublicShare, SearchPayload, SessionPreferences, ShareLink, Track, VKImportJob, VKImportResult } from '../types'

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function apiErrorMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return 'Ошибка запроса'
  const detail = (body as { detail?: unknown }).detail
  if (typeof detail === 'string') return detail
  if (!Array.isArray(detail)) return 'Не удалось обработать запрос. Проверьте заполнение полей.'
  const issue = detail.find((item) => item && typeof item === 'object') as { loc?: unknown[]; msg?: unknown; type?: unknown } | undefined
  if (!issue) return 'Не удалось обработать запрос. Проверьте заполнение полей.'
  const field = String(issue.loc?.at(-1) || '')
  if (field === 'username') return 'Логин может содержать только латинские буквы, цифры, точку, дефис и подчёркивание. Email здесь не используется.'
  if (field === 'password' || field === 'currentPassword') return 'Проверьте пароль: новый пароль должен содержать не меньше 10 символов.'
  if (field === 'displayName') return 'Укажите имя, которое будет отображаться в профиле.'
  return typeof issue.msg === 'string' && !issue.msg.startsWith('String should')
    ? issue.msg
    : 'Не удалось обработать запрос. Проверьте заполнение полей.'
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: 'Ошибка запроса' }))
    throw new ApiError(apiErrorMessage(body), response.status)
  }
  return response.json() as Promise<T>
}

export async function getBootstrap(): Promise<BootstrapPayload> {
  return request<BootstrapPayload>('/bootstrap')
}

export async function registerAccount(username: string, displayName: string, password: string): Promise<AppUser> {
  return request<AppUser>('/account/register', { method: 'POST', body: JSON.stringify({ username, displayName, password }) })
}

export async function loginAccount(username: string, password: string): Promise<AppUser> {
  return request<AppUser>('/account/login', { method: 'POST', body: JSON.stringify({ username, password }) })
}

export async function logoutAccount(): Promise<void> {
  await request('/account/logout', { method: 'POST' })
}

export async function setAccountPassword(password: string, currentPassword?: string): Promise<void> {
  await request('/account/password', { method: 'PUT', body: JSON.stringify({ password, ...(currentPassword ? { currentPassword } : {}) }) })
}

export async function startDeviceAuth(): Promise<DeviceAuthStart> {
  return request<DeviceAuthStart>('/auth/device/start', { method: 'POST' })
}

export async function pollDeviceAuth(deviceId: string): Promise<{ connected: boolean }> {
  return request('/auth/device/poll', { method: 'POST', body: JSON.stringify({ deviceId }) })
}

export async function disconnectYandex(): Promise<void> {
  await request('/auth/logout', { method: 'POST' })
}

export async function importVKTracks(sourceUrl: string, tracks: Array<{ title: string; artist: string; duration?: string }>): Promise<VKImportResult> {
  return request<VKImportResult>('/import/vk', { method: 'POST', body: JSON.stringify({ sourceUrl, tracks }) })
}

export async function startVKImportJob(sourceUrl: string, tracks: Array<{ title: string; artist: string; duration?: string }>): Promise<VKImportJob> {
  return request<VKImportJob>('/import/vk/jobs', { method: 'POST', body: JSON.stringify({ sourceUrl, tracks }) })
}

export async function decodeVKImportFragment(hash: string): Promise<{ sourceUrl: string; tracks: Array<{ title: string; artist: string; duration?: string }> }> {
  const match = hash.replace(/^#/, '').match(/^([gj])\.([A-Za-z0-9_-]+)$/)
  if (!match) throw new Error('Данные импорта VK повреждены или имеют неизвестный формат')
  const base64 = match[2].replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
  let bytes = Uint8Array.from(window.atob(padded), (character) => character.charCodeAt(0))
  if (match[1] === 'g') {
    const decompressed = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    bytes = new Uint8Array(await new Response(decompressed).arrayBuffer())
  }
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as { sourceUrl?: unknown; tracks?: unknown }
  if (typeof payload.sourceUrl !== 'string' || !Array.isArray(payload.tracks)) throw new Error('В данных импорта VK нет списка треков')
  const tracks = payload.tracks.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    if (typeof candidate.title !== 'string' || typeof candidate.artist !== 'string') return []
    return [{ title: candidate.title, artist: candidate.artist, ...(typeof candidate.duration === 'string' ? { duration: candidate.duration } : {}) }]
  }).slice(0, 10000)
  if (!tracks.length) throw new Error('В списке VK не найдено ни одного трека')
  return { sourceUrl: payload.sourceUrl, tracks }
}

export async function getLatestVKImportJob(): Promise<VKImportJob | null> {
  return request<VKImportJob | null>('/import/vk/jobs/latest')
}

export async function searchMusic(query: string): Promise<SearchPayload> {
  if (!query.trim()) return { tracks: [], playlists: [], profiles: [] }
  return request<SearchPayload>(`/search?q=${encodeURIComponent(query)}`)
}

export async function searchProfiles(query: string): Promise<ProfileSummary[]> {
  if (!query.trim()) return []
  return request<ProfileSummary[]>(`/profiles/search?q=${encodeURIComponent(query)}`)
}

export async function getPublicProfile(username: string): Promise<PublicProfile> {
  return request<PublicProfile>(`/profiles/${encodeURIComponent(username)}`)
}

export async function getPublicProfilePlaylist(username: string, playlistId: string): Promise<Playlist> {
  return request<Playlist>(`/profiles/${encodeURIComponent(username)}/playlists/${encodeURIComponent(playlistId)}`)
}

export async function getAllLikedTracks(): Promise<LikedTracksPayload> {
  return request<LikedTracksPayload>('/liked-tracks')
}

export async function getListeningStats(): Promise<ListeningStats> {
  return request<ListeningStats>('/listening-stats')
}

export async function getDiscoveryRecommendations(): Promise<DiscoveryRecommendations> {
  return request<DiscoveryRecommendations>('/discovery-recommendations')
}

export async function getPlaylist(playlistId: string): Promise<Playlist> {
  return request<Playlist>(`/playlists/${encodeURIComponent(playlistId)}`)
}

export async function createLocalPlaylist(title: string, description = '', isPublic = false): Promise<Playlist> {
  return request<Playlist>('/local-playlists', { method: 'POST', body: JSON.stringify({ title, description, isPublic }) })
}

export async function getLocalPlaylists(): Promise<Playlist[]> {
  return request<Playlist[]>('/local-playlists')
}

export async function updateLocalPlaylist(playlistId: string, changes: { title?: string; description?: string; isPublic?: boolean }): Promise<Playlist> {
  return request<Playlist>(`/local-playlists/${encodeURIComponent(playlistId)}`, { method: 'PATCH', body: JSON.stringify(changes) })
}

export async function deleteLocalPlaylist(playlistId: string): Promise<void> {
  await request(`/local-playlists/${encodeURIComponent(playlistId)}`, { method: 'DELETE' })
}

export async function updateLocalPlaylistCover(playlistId: string, dataUrl: string): Promise<Playlist> {
  return request<Playlist>(`/local-playlists/${encodeURIComponent(playlistId)}/cover`, { method: 'PUT', body: JSON.stringify({ dataUrl }) })
}

export async function addTrackToLocalPlaylist(playlistId: string, track: Track): Promise<Playlist> {
  return request<Playlist>(`/local-playlists/${encodeURIComponent(playlistId)}/tracks`, { method: 'POST', body: JSON.stringify({ track }) })
}

export async function removeTrackFromLocalPlaylist(playlistId: string, trackId: string): Promise<Playlist> {
  return request<Playlist>(`/local-playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`, { method: 'DELETE' })
}

export async function recordListeningEvent(track: Track, listenedMs: number): Promise<void> {
  await request('/listening-events', { method: 'POST', body: JSON.stringify({ track, listenedMs, source: 'player' }) })
}

export async function buildSession(preferences: SessionPreferences): Promise<{ tracks: Track[] }> {
  return request<{ tracks: Track[] }>('/sessions/build', {
    method: 'POST',
    body: JSON.stringify(preferences),
  })
}

export async function toggleLike(trackId: string, liked: boolean): Promise<void> {
  await request(`/tracks/${encodeURIComponent(trackId)}/like`, {
    method: liked ? 'PUT' : 'DELETE',
  })
}

export async function createTrackShare(track: Track): Promise<ShareLink> {
  return request<ShareLink>('/shares/tracks', {
    method: 'POST',
    body: JSON.stringify({ track }),
  })
}

export async function createPlaylistShare(playlistId: string): Promise<ShareLink> {
  return request<ShareLink>('/shares/playlists', {
    method: 'POST',
    body: JSON.stringify({ playlistId }),
  })
}

export async function getPublicShare(token: string): Promise<PublicShare> {
  return request<PublicShare>(`/shares/${encodeURIComponent(token)}`)
}
