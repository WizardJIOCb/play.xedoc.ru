import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareButton } from './ShareButton'
import { AuthPromptProvider } from '../auth/AuthPromptContext'

const api = vi.hoisted(() => ({
  createTrackShare: vi.fn(),
  createPlaylistShare: vi.fn(),
}))

vi.mock('../lib/api', () => api)

describe('ShareButton', () => {
  const writeText = vi.fn()
  const nativeShare = vi.fn()

  afterEach(cleanup)

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

  it('copies a full-track link immediately without opening a dialog or triggering the row', async () => {
    const onRowClick = vi.fn()
    const track = { id: 'track-1', title: 'Signal', artists: ['Artist'], durationMs: 180_000 }
    render(<div onClick={onRowClick}><ShareButton track={track} direct startAtSeconds={67} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'Поделиться: Signal' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost:3000/share/public-token'))
    expect(api.createTrackShare).toHaveBeenCalledWith(track)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onRowClick).not.toHaveBeenCalled()
    expect(nativeShare).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Ссылка скопирована')
  })

  it('keeps the existing sign-in requirement for direct sharing', () => {
    const onRequireAuth = vi.fn()
    render(<AuthPromptProvider authenticated={false} onRequireAuth={onRequireAuth}><ShareButton track={{ id: 'track-1', title: 'Signal', artists: ['Artist'], durationMs: 180_000 }} direct /></AuthPromptProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Поделиться: Signal' }))
    expect(onRequireAuth).toHaveBeenCalledOnce()
    expect(api.createTrackShare).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })
})
