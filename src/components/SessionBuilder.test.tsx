import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlayerProvider } from '../player/PlayerContext'
import { SessionBuilder } from './SessionBuilder'

describe('SessionBuilder', () => {
  afterEach(cleanup)

  it('keeps the selected discovery balance when the parent callback changes', () => {
    const view = render(<PlayerProvider><SessionBuilder open initialDiscovery={58} onClose={vi.fn()} /></PlayerProvider>)
    const slider = screen.getByRole('slider', { name: 'Баланс открытий' })

    fireEvent.change(slider, { target: { value: '82' } })
    expect(screen.getByText('82% нового')).toBeInTheDocument()

    view.rerender(<PlayerProvider><SessionBuilder open initialDiscovery={58} onClose={vi.fn()} /></PlayerProvider>)
    expect(screen.getByText('82% нового')).toBeInTheDocument()
    expect(slider).toHaveValue('82')
  })
})
