import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PublicSharePage } from './PublicSharePage'

const mocks = vi.hoisted(() => ({
  getPublicShare: vi.fn(),
  playQueue: vi.fn(),
}))

vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  getPublicShare: mocks.getPublicShare,
}))

vi.mock('../player/PlayerContext', () => ({
  usePlayer: () => ({ playQueue: mocks.playQueue }),
}))

vi.mock('./PlayerBar', () => ({ PlayerBar: () => null }))
vi.mock('./TrackRow', () => ({ TrackRow: () => null }))

const sharedTrack = {
  id: 'shared-track',
  title: 'Shared signal',
  artists: ['Artist'],
  durationMs: 180_000,
  streamUrl: '/api/shares/public-token/tracks/shared-track/stream',
}

describe('PublicSharePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/share/public-token')
    mocks.getPublicShare.mockResolvedValue({
      token: 'public-token',
      kind: 'track',
      sharedBy: 'Rodion',
      createdAt: 1_700_000_000,
      track: sharedTrack,
    })
  })

  it('autoplays a timestamped track link from the requested second', async () => {
    window.history.replaceState(null, '', '/share/public-token?t=83')

    render(<PublicSharePage token="public-token" />)

    expect(await screen.findByRole('heading', { name: 'Shared signal' })).toBeInTheDocument()
    await waitFor(() => expect(mocks.playQueue).toHaveBeenCalledWith([sharedTrack], 0, undefined, 83))
    expect(screen.getByText('Поделился Rodion · старт с 1:23')).toBeInTheDocument()
  })

  it('keeps legacy links paused until the listener starts them', async () => {
    render(<PublicSharePage token="public-token" />)

    expect(await screen.findByRole('heading', { name: 'Shared signal' })).toBeInTheDocument()
    expect(mocks.playQueue).not.toHaveBeenCalled()
  })
})
