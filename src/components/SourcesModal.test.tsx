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
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('does not send an unconfigured user to VK without explaining the required bookmark', async () => {
    render(<SourcesModal open yandexConnected onClose={() => undefined} onConnectYandex={() => undefined} onChanged={() => undefined} />)

    expect(await screen.findByText('Источник подключён')).toBeInTheDocument()
    expect(getLatestVKImportJob).toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: '1. Открыть VK' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Настроить обновление' })).toBeInTheDocument()
    expect(await screen.findByText('Без закладки сбор в VK не запустится')).toBeInTheDocument()
    expect(screen.getByText('Ctrl')).toBeInTheDocument()
    const bookmark = screen.getByRole('link', { name: 'Обновить XEDOC' })
    const currentUrl = window.location.href
    fireEvent.click(bookmark)
    expect(window.location.href).toBe(currentUrl)
    expect(screen.getByText(/Chrome превратит его в поиск Google/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Скопировать код кнопки' })).not.toBeInTheDocument()
    const finish = screen.getByRole('button', { name: 'Готово — открыть VK' })
    expect(finish).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Закладка «Обновить XEDOC» видна на панели' }))
    expect(finish).toBeEnabled()
    expect(screen.getByText('Проверено новых позиций: 1 · найдено 2')).toBeInTheDocument()
  })

  it('shows the honest two-step refresh after the bookmark was configured', async () => {
    window.localStorage.setItem('xedoc_vk_collector_ready_v1', '1')
    render(<SourcesModal open yandexConnected onClose={() => undefined} onConnectYandex={() => undefined} onChanged={() => undefined} />)

    expect(await screen.findByText('Источник подключён')).toBeInTheDocument()
    const refresh = screen.getByRole('link', { name: '1. Открыть VK' })
    expect(refresh).toHaveAttribute('href', 'https://vk.ru/audios145429079?section=all')
    expect(refresh).not.toHaveAttribute('target')
    expect(screen.getByText('2. В VK нажмите «Обновить XEDOC» на панели закладок.')).toBeInTheDocument()
    expect(screen.queryByText('Без закладки сбор в VK не запустится')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Переустановить закладку «Обновить XEDOC»' }))
    expect(await screen.findByText('Без закладки сбор в VK не запустится')).toBeInTheDocument()
  })
})
