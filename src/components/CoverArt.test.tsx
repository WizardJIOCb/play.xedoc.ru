import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CoverArt } from './CoverArt'

describe('CoverArt', () => {
  it('renders generated initials when an image is unavailable', () => {
    render(<CoverArt title="Ночной маршрут" tone="violet" />)
    expect(screen.getByText('Нм')).toBeInTheDocument()
  })

  it('renders a real image above the decorative fallback', () => {
    const { container } = render(<CoverArt title="Плейлист дня" url="https://example.test/cover/%%" />)
    const image = container.querySelector('.cover__image')

    expect(image).toHaveAttribute('src', 'https://example.test/cover/400x400')
    expect(container.querySelector('.cover')).toHaveClass('cover--has-image')
    expect(screen.queryByText('Пд')).not.toBeInTheDocument()
  })

  it('restores the generated fallback when an image fails to load', () => {
    const { container } = render(<CoverArt title="Плейлист дня" url="https://example.test/broken" />)
    fireEvent.error(container.querySelector('.cover__image') as HTMLImageElement)

    expect(container.querySelector('.cover')).toHaveClass('cover--fallback')
    expect(screen.getByText('Пд')).toBeInTheDocument()
  })

  it('exposes a working play action', () => {
    const onPlay = vi.fn()
    render(<CoverArt title="Редкий фокус" playable onPlay={onPlay} />)
    fireEvent.click(screen.getByRole('button', { name: 'Включить Редкий фокус' }))
    expect(onPlay).toHaveBeenCalledOnce()
  })
})
