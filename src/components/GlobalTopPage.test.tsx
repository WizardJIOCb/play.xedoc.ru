import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalTopPayload, Track } from '../types'
import { GlobalTopPage } from './GlobalTopPage'

const mocks = vi.hoisted(() => ({ playQueue: vi.fn(), getGlobalTopSection: vi.fn() }))

vi.mock('../lib/api', () => ({
  getGlobalTopSection: mocks.getGlobalTopSection,
}))

vi.mock('../player/PlayerContext', () => ({
  usePlayer: () => ({ playQueue: mocks.playQueue }),
}))

vi.mock('./TrackRow', () => ({
  TrackRow: ({ track }: { track: Track }) => <div>{track.title}</div>,
}))

afterEach(cleanup)

const track = (id: string, title: string): Track => ({
  id,
  title,
  artists: ['Artist'],
  durationMs: 180_000,
})

const foreignRock = track('foreign-rock', 'Foreign rock track')
const foreignMetal = track('foreign-metal', 'Foreign metal track')
const russianRock = track('russian-rock', 'Russian rock track')
const russianPunk = track('russian-punk', 'Russian punk track')

const payload: GlobalTopPayload = {
  generatedAt: 1_700_000_000,
  editionDate: '2026-08-29',
  chartTitle: 'Мировой чарт',
  chart: [],
  releases: [],
  genres: [
    { id: 'rock', title: 'Рок', scope: 'international', sourceTitle: 'Вечный рок', tracks: [foreignRock] },
    { id: 'metal', title: 'Метал', scope: 'international', sourceTitle: 'Легенды метала', tracks: [foreignMetal] },
    { id: 'rusrock', title: 'Русский рок', scope: 'russian', sourceTitle: 'Новый русский рок', tracks: [russianRock] },
    { id: 'ruspunk', title: 'Русский панк', scope: 'russian', sourceTitle: 'Лучшие песни русского панк-рока', tracks: [russianPunk] },
  ],
}

describe('GlobalTopPage genre rankings', () => {
  it('switches between international and Russian ratings and plays the selected genre', () => {
    mocks.playQueue.mockReset()
    render(<GlobalTopPage data={payload} loading={false} />)

    expect(screen.getByRole('heading', { name: 'Жанровые рейтинги' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Зарубежная/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /^Метал/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /^Русский панк/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /^Русская/ }))
    expect(screen.getByRole('tab', { name: /^Русский рок/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /^Русский панк/ }))

    expect(screen.getByRole('heading', { name: 'Русский панк' })).toBeInTheDocument()
    expect(screen.getByText('По порядку в подборке «Лучшие песни русского панк-рока»')).toBeInTheDocument()
    expect(screen.getByText('Russian punk track')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Слушать жанр' }))
    expect(mocks.playQueue).toHaveBeenCalledWith([russianPunk])
  })

  it('opens a rubric from its heading and loads the remaining tracks', async () => {
    const chart = Array.from({ length: 25 }, (_, index) => track(`chart-${index + 1}`, `Chart track ${index + 1}`))
    mocks.getGlobalTopSection.mockReset().mockImplementation((_kind: string, _id: string | undefined, offset: number, limit: number) => Promise.resolve({
      kind: 'chart',
      id: 'chart',
      title: 'Мировой чарт',
      total: chart.length,
      offset,
      limit,
      hasMore: offset + limit < chart.length,
      tracks: chart.slice(offset, offset + limit),
      releases: [],
    }))
    render(<GlobalTopPage data={{ ...payload, chart }} loading={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Мировой чарт' }))

    expect(await screen.findByText('Chart track 20')).toBeInTheDocument()
    expect(screen.queryByText('Chart track 21')).not.toBeInTheDocument()
    expect(mocks.getGlobalTopSection).toHaveBeenCalledWith('chart', undefined, 0, 20)

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё 5' }))

    expect(await screen.findByText('Chart track 25')).toBeInTheDocument()
    expect(mocks.getGlobalTopSection).toHaveBeenLastCalledWith('chart', undefined, 20, 20)
    expect(screen.queryByRole('button', { name: /Показать ещё/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Все рубрики' }))
    expect(screen.getByRole('heading', { name: 'Жанровые рейтинги' })).toBeInTheDocument()
  })
})
