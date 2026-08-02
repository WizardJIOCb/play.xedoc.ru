import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CoverArt } from './CoverArt'

describe('CoverArt', () => {
  it('renders generated initials when an image is unavailable', () => {
    render(<CoverArt title="Ночной маршрут" tone="violet" />)
    expect(screen.getByText('Нм')).toBeInTheDocument()
  })

  it('exposes a working play action', () => {
    const onPlay = vi.fn()
    render(<CoverArt title="Редкий фокус" playable onPlay={onPlay} />)
    fireEvent.click(screen.getByRole('button', { name: 'Включить Редкий фокус' }))
    expect(onPlay).toHaveBeenCalledOnce()
  })
})
