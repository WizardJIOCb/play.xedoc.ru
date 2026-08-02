import type { BootstrapPayload, DeviceAuthStart, Playlist, PublicShare, SearchPayload, SessionPreferences, ShareLink, Track } from '../types'

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

export async function unlockAccess(key: string): Promise<void> {
  await request('/access/unlock', { method: 'POST', body: JSON.stringify({ key }) })
}

export async function startDeviceAuth(): Promise<DeviceAuthStart> {
  return request<DeviceAuthStart>('/auth/device/start', { method: 'POST' })
}

export async function pollDeviceAuth(deviceId: string): Promise<{ connected: boolean }> {
  return request('/auth/device/poll', { method: 'POST', body: JSON.stringify({ deviceId }) })
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' })
}

export async function searchMusic(query: string): Promise<SearchPayload> {
  if (!query.trim()) return { tracks: [], playlists: [] }
  return request<SearchPayload>(`/search?q=${encodeURIComponent(query)}`)
}

export async function getPlaylist(playlistId: string): Promise<Playlist> {
  return request<Playlist>(`/playlists/${encodeURIComponent(playlistId)}`)
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
