import type { AppUser, BootstrapPayload, DeviceAuthStart, DiscoveryRecommendations, LikedTracksPayload, ListeningStats, Playlist, PublicShare, SearchPayload, SessionPreferences, ShareLink, Track, VKImportResult } from '../types'

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: 'Ошибка запроса' }))
    throw new ApiError(body.detail || 'Ошибка запроса', response.status)
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

export async function setAccountPassword(password: string): Promise<void> {
  await request('/account/password', { method: 'PUT', body: JSON.stringify({ password }) })
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

export async function searchMusic(query: string): Promise<SearchPayload> {
  if (!query.trim()) return { tracks: [], playlists: [] }
  return request<SearchPayload>(`/search?q=${encodeURIComponent(query)}`)
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

export async function createLocalPlaylist(title: string, description = ''): Promise<Playlist> {
  return request<Playlist>('/local-playlists', { method: 'POST', body: JSON.stringify({ title, description }) })
}

export async function getLocalPlaylists(): Promise<Playlist[]> {
  return request<Playlist[]>('/local-playlists')
}

export async function updateLocalPlaylist(playlistId: string, changes: { title?: string; description?: string }): Promise<Playlist> {
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
