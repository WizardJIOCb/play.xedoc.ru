import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLatestVKImportJob } from '../lib/api'
import { SourcesModal } from './SourcesModal'

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>()
  return {
    ...original,
    getLatestVKImportJob: vi.fn().mockResolvedValue({
      id: 'vkjob-fixture', status: 'complete', sourceUrl: 'https://vk.ru/audios145429079',
      total: 3, reused: 2, processed: 3, matched: 2, unmatched: 1,
      createdAt: 1_700_000_000, updatedAt: 1_700_000_100,
    }),
  }
})

describe('VK source refresh', () => {
  afterEach(() => cleanup())

  it('shows a simple refresh action and reports only newly checked positions', async () => {
    render(<SourcesModal open yandexConnected onClose={() => undefined} onConnectYandex={() => undefined} onChanged={() => undefined} />)

    expect(await screen.findByText('Источник подключён')).toBeInTheDocument()
    expect(getLatestVKImportJob).toHaveBeenCalled()
    const refresh = screen.getByRole('link', { name: 'Обновить музыку' })
    expect(refresh).toHaveAttribute('href', 'https://vk.ru/audios145429079?section=all')
    expect(screen.getByText('Проверено новых позиций: 1 · найдено 2')).toBeInTheDocument()
    expect(await screen.findByText('Синхронизировать с XEDOC')).toBeInTheDocument()
  })
})
