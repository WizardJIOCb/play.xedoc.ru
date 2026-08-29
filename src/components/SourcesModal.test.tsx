import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('keeps the VK refresh in one tab and hides one-time setup by default', async () => {
    render(<SourcesModal open yandexConnected onClose={() => undefined} onConnectYandex={() => undefined} onChanged={() => undefined} />)

    expect(await screen.findByText('Источник подключён')).toBeInTheDocument()
    expect(getLatestVKImportJob).toHaveBeenCalled()
    const refresh = screen.getByRole('link', { name: 'Перейти в VK и обновить' })
    expect(refresh).toHaveAttribute('href', 'https://vk.ru/audios145429079?section=all')
    expect(refresh).not.toHaveAttribute('target')
    expect(screen.getByText('Проверено новых позиций: 1 · найдено 2')).toBeInTheDocument()
    expect(screen.queryByText('Обновить XEDOC')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Нет закладки «Обновить XEDOC»?' }))

    expect(screen.getByText('Настройка нужна один раз')).toBeInTheDocument()
    expect(screen.getByText('Обновить XEDOC')).toBeInTheDocument()
  })
})
