import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoBootstrap, demoTracks } from '../data/demo'
import { getDiscoveryRecommendations } from '../lib/api'
import type { BootstrapPayload, DiscoveryRecommendations } from '../types'
import { DiscoveryHero } from './DiscoveryHero'

const player = vi.hoisted(() => ({ current: undefined, isPlaying: false, playQueue: vi.fn(), playTrack: vi.fn(), togglePlayback: vi.fn() }))
vi.mock('../player/PlayerContext', () => ({ usePlayer: () => player }))
vi.mock('../lib/api', () => ({ getDiscoveryRecommendations: vi.fn() }))

const discoveries: DiscoveryRecommendations = { tracks: demoTracks.slice(0, 4), seedCount: 5, knownTrackCount: 42, insight: '' }
const data: BootstrapPayload = {
  ...demoBootstrap, authenticated: true, catalogAvailable: true,
  xedocCollections: [
    { id: 'week', title: 'Неделя', subtitle: '', periodDays: 7, signalCount: 10, fallback: false, tracks: demoTracks.slice(4, 8) },
    { id: 'month', title: 'Месяц', subtitle: '', periodDays: 30, signalCount: 0, fallback: true, tracks: demoTracks.slice(8) },
  ],
}

describe('home discovery hero', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDiscoveryRecommendations).mockResolvedValue(discoveries)
  })
  afterEach(cleanup)

  it('plays the full discovery queue and starts a preview track in that same queue', async () => {
    const onRecommendations = vi.fn()
    render(<DiscoveryHero data={data} onRecommendations={onRecommendations} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Включить Afterglow' }))
    expect(player.playTrack).toHaveBeenCalledWith(demoTracks[0], discoveries.tracks)
    fireEvent.click(screen.getByRole('button', { name: 'Слушать новое' }))
    expect(player.playQueue).toHaveBeenLastCalledWith(discoveries.tracks)
    fireEvent.click(screen.getByRole('button', { name: 'Все рекомендации' }))
    expect(onRecommendations).toHaveBeenCalledOnce()
  })

  it('lets a weekly collection play while discovery is loading and labels fallback months', async () => {
    vi.mocked(getDiscoveryRecommendations).mockReturnValue(new Promise(() => {}))
    render(<DiscoveryHero data={data} onRecommendations={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Слушать новое' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'За неделю' }))
    expect(screen.getByRole('heading', { name: 'Ваша неделя в музыке' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Слушать подборку' }))
    expect(player.playQueue).toHaveBeenLastCalledWith(data.xedocCollections[0].tracks)
    fireEvent.click(screen.getByRole('button', { name: 'За месяц' }))
    expect(screen.getByText(/В этом периоде пока мало прослушиваний/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Слушать подборку' }))
    expect(player.playQueue).toHaveBeenLastCalledWith(data.xedocCollections[1].tracks)
  })

  it('offers retry after a failed request without substituting familiar tracks', async () => {
    vi.mocked(getDiscoveryRecommendations).mockRejectedValueOnce(new Error('offline'))
    render(<DiscoveryHero data={data} onRecommendations={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Попробовать снова' }))
    expect(await screen.findByRole('button', { name: 'Включить Afterglow' })).toBeInTheDocument()
    expect(getDiscoveryRecommendations).toHaveBeenCalledTimes(2)
  })

  it('keeps empty discoveries unplayable even when quick tracks are available', async () => {
    vi.mocked(getDiscoveryRecommendations).mockResolvedValue({ ...discoveries, tracks: [] })
    render(<DiscoveryHero data={data} onRecommendations={vi.fn()} />)
    await waitFor(() => expect(screen.queryByText('Ищем музыку для новых открытий…')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Слушать новое' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Включить Afterglow' })).not.toBeInTheDocument()
  })
})
