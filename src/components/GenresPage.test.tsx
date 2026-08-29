import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenrePeriod, GlobalTopPayload, Track } from '../types'
import { GenresPage } from './GenresPage'

const mocks = vi.hoisted(() => ({ playQueue: vi.fn(), getGlobalTopSection: vi.fn() }))

vi.mock('../lib/api', () => ({ getGlobalTopSection: mocks.getGlobalTopSection }))
vi.mock('../player/PlayerContext', () => ({ usePlayer: () => ({ playQueue: mocks.playQueue }) }))
vi.mock('./TrackRow', () => ({ TrackRow: ({ track }: { track: Track }) => <div>{track.title}</div> }))

const track = (id: string, title: string, releaseDate: string): Track => ({ id, title, artists: ['Artist'], durationMs: 180_000, releaseDate })
const rockTrack = track('rock-one', 'Rock signal', '2026-08-20')
const ambientTrack = track('ambient-one', 'Ambient signal', '2021-03-10')
const russianTrack = track('rus-one', 'Русский сигнал', '2017-04-12')

const payload: GlobalTopPayload = {
  generatedAt: 1_700_000_000,
  editionDate: '2026-08-29',
  chartTitle: 'Мировой чарт',
  chart: [],
  releases: [],
  genres: [
    { id: 'rock', title: 'Рок', scope: 'international', sourceTitle: 'Вечный рок', tracks: [rockTrack] },
    { id: 'ambient', title: 'Эмбиент', scope: 'international', sourceTitle: 'Узоры тишины', tracks: [ambientTrack] },
    { id: 'rusrock', title: 'Русский рок', scope: 'russian', sourceTitle: 'Новый русский рок', tracks: [russianTrack] },
  ],
}

describe('GenresPage', () => {
  beforeEach(() => {
    mocks.playQueue.mockReset()
    mocks.getGlobalTopSection.mockReset().mockImplementation((_kind: string, id: string, offset: number, limit: number, period: GenrePeriod) => {
      const source = id === 'ambient' ? [ambientTrack] : id === 'rusrock' ? [russianTrack] : [rockTrack]
      return Promise.resolve({ kind: 'genre', id, title: id, total: source.length, offset, limit, hasMore: false, tracks: source, releases: [], period })
    })
  })
  afterEach(cleanup)

  it('browses genres, periods and Russian rankings', async () => {
    render(<GenresPage data={payload} loading={false} />)

    expect(screen.getByRole('heading', { name: /Найдите свой жанр/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Зарубежные/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Rock signal')).toBeInTheDocument()
    expect(mocks.getGlobalTopSection).toHaveBeenCalledWith('genre', 'rock', 0, 20, 'all')

    fireEvent.click(screen.getByRole('button', { name: /Эмбиент/ }))
    expect(await screen.findByText('Ambient signal')).toBeInTheDocument()
    expect(mocks.getGlobalTopSection).toHaveBeenLastCalledWith('genre', 'ambient', 0, 20, 'all')

    fireEvent.click(screen.getByRole('tab', { name: /2020-е/ }))
    await waitFor(() => expect(mocks.getGlobalTopSection).toHaveBeenLastCalledWith('genre', 'ambient', 0, 20, '2020s'))

    fireEvent.change(screen.getByRole('textbox', { name: 'Найти жанр' }), { target: { value: 'рок' } })
    expect(screen.getByRole('button', { name: /Рок/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Эмбиент/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Русские/ }))
    expect(screen.getByRole('button', { name: /Русский рок/ })).toBeInTheDocument()
    expect(await screen.findByText('Русский сигнал')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Слушать выборку' }))
    expect(mocks.playQueue).toHaveBeenCalledWith([russianTrack])
  })
})
