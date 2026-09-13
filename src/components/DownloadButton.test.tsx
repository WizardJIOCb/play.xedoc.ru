import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DownloadButton } from './DownloadButton'

const track = { id: '101', title: 'Песня', artists: ['Артист'], durationMs: 1000, streamUrl: '/api/public-search/tracks/101/stream?ticket=signed-ticket' }
const fetchMock = vi.fn()
let savedName = ''

beforeEach(() => {
  savedName = ''
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:download')
    static revokeObjectURL = vi.fn()
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { savedName = this.download })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); fetchMock.mockReset() })

describe('download button', () => {
  it('keeps the public ticket, saves the audio filename and does not toggle the row', async () => {
    const toggle = vi.fn()
    fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(['audio'], { type: 'audio/mpeg' }), headers: new Headers() })
    render(<div onClick={toggle}><DownloadButton track={track} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'Скачать Песня' }))
    await waitFor(() => expect(savedName).toBe('Артист - Песня.mp3'))
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.get('ticket')).toBe('signed-ticket')
    expect(url.searchParams.get('download')).toBe('1')
    expect(toggle).not.toHaveBeenCalled()
  })
  it('keeps generated audio in WAV format', async () => {
    fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(['RIFF'], { type: 'audio/wav' }), headers: new Headers() })
    render(<DownloadButton track={{ ...track, id: 'generated:one', streamUrl: undefined }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Скачать Песня' }))
    await waitFor(() => expect(savedName).toBe('Артист - Песня.wav'))
  })
  it('shows a recoverable error without saving an error response', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ detail: 'Ссылка на трек истекла' }) })
    render(<DownloadButton track={track} />)
    fireEvent.click(screen.getByRole('button', { name: 'Скачать Песня' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ссылка на трек истекла')
    expect(savedName).toBe('')
    expect(screen.getByRole('button', { name: 'Скачать Песня' })).toBeEnabled()
  })
})
