import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdminDashboardPage } from './AdminDashboardPage'

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>()
  return {
    ...original,
    getAdminDashboard: vi.fn().mockResolvedValue({
      summary: {
        usersTotal: 3, newUsers7d: 1, activeUsers30d: 2, yandexConnected: 2,
        playlistsTotal: 4, publicPlaylists: 1, playlistTracks: 25,
        totalPlays: 18, uniqueTracks: 9, totalListenedMs: 3_600_000, publicShares: 2,
      },
      users: [{
        username: 'wizardjiocb911', displayName: 'Rodion', isAdmin: true,
        avatarUrl: 'https://cdn.example.test/rodion.webp',
        createdAt: 1_700_000_000, yandexConnected: true, playlists: 2,
        publicPlaylists: 1, playlistTracks: 20, totalPlays: 12,
        uniqueTracks: 7, totalListenedMs: 3_000_000, lastPlayedAt: 1_700_000_000,
      }],
      topTracks: [{ id: '1', title: 'Signal', artists: ['Artist'], durationMs: 180_000, playCount: 12 }],
    }),
  }
})

describe('AdminDashboardPage', () => {
  it('shows service metrics and user administration data', async () => {
    render(<AdminDashboardPage isAdmin />)
    expect(await screen.findByRole('heading', { name: 'Админка сервиса' })).toBeInTheDocument()
    expect(screen.getByText('@wizardjiocb911')).toBeInTheDocument()
    expect(screen.getByText('Signal')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Регистрация')).toBeInTheDocument()
    expect(screen.getByLabelText('Дата регистрации Rodion')).toHaveTextContent('2023')
    expect(screen.getByRole('presentation')).toHaveAttribute('src', 'https://cdn.example.test/rodion.webp')
  })

  it('does not request or render data without the admin role', () => {
    render(<AdminDashboardPage isAdmin={false} />)
    expect(screen.getByRole('heading', { name: 'Раздел только для администратора' })).toBeInTheDocument()
  })
})
