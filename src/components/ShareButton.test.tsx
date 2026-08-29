import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareButton } from './ShareButton'

const api = vi.hoisted(() => ({
  createTrackShare: vi.fn(),
  createPlaylistShare: vi.fn(),
}))

vi.mock('../lib/api', () => api)

describe('ShareButton', () => {
  const writeText = vi.fn()
  const nativeShare = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    api.createTrackShare.mockResolvedValue({ token: 'public-token', path: '/share/public-token' })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    writeText.mockResolvedValue(undefined)
  })

  it('copies an autoplay track link with the selected start second', async () => {
    render(<ShareButton track={{ id: 'track-1', title: 'Signal', artists: ['Artist'], durationMs: 180_000 }} startAtSeconds={67.8} />)

    fireEvent.click(screen.getByRole('button', { name: 'Поделиться: Signal' }))
    expect(screen.getByRole('dialog', { name: 'С какой секунды включить?' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Начать с секунды' })).toHaveValue(67)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Начать с секунды' }), { target: { value: '83' } })
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать ссылку' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost:3000/share/public-token?t=83'))
    expect(nativeShare).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Ссылка скопирована')
  })
})
