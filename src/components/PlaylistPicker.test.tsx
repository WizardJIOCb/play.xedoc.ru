import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Playlist, Track } from '../types'
import { PlaylistPicker } from './PlaylistPicker'

const api = vi.hoisted(() => ({
  addTrackToLocalPlaylist: vi.fn(),
  createLocalPlaylist: vi.fn(),
  getLocalPlaylists: vi.fn(),
}))

vi.mock('../lib/api', () => api)
vi.mock('../lib/analytics', () => ({ trackGoal: vi.fn() }))

const track: Track = { id: 'track-1', title: 'Тестовый трек', artists: ['Артист'], durationMs: 180_000 }
const playlist: Playlist = { id: 'playlist-1', title: 'Мой плейлист', trackCount: 3, local: true }

describe('playlist picker', () => {
  beforeEach(() => {
    api.getLocalPlaylists.mockReset().mockResolvedValue([playlist])
    api.addTrackToLocalPlaylist.mockReset().mockResolvedValue({ ...playlist, trackCount: 4 })
    api.createLocalPlaylist.mockReset()
  })

  afterEach(() => cleanup())

  it('opens above clipped containers and adds the track to a selected playlist', async () => {
    const view = render(<div style={{ overflow: 'hidden' }}><PlaylistPicker track={track} /></div>)

    fireEvent.click(screen.getByRole('button', { name: 'Добавить Тестовый трек в плейлист или очередь' }))

    expect(await screen.findByText('Мой плейлист')).toBeInTheDocument()
    const menu = document.body.querySelector<HTMLElement>('.playlist-picker__menu')
    expect(menu).not.toBeNull()
    expect(view.container).not.toContainElement(menu)

    fireEvent.click(screen.getByRole('button', { name: /Мой плейлист/ }))
    await waitFor(() => expect(api.addTrackToLocalPlaylist).toHaveBeenCalledWith('playlist-1', track))
  })
})
