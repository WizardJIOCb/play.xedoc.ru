import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoverArt } from './CoverArt'

afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close') })

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


it('opens a large cover without triggering its parent and closes back to the image', () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open') } })
  const play = vi.fn()
  render(<div onClick={play}><CoverArt title="Альбом" url="https://example.test/%%" /></div>)
  const trigger = screen.getByRole('button', { name: 'Увеличить обложку: Альбом' })
  trigger.focus()
  fireEvent.click(trigger)
  expect(screen.getByRole('dialog', { name: 'Обложка: Альбом' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Обложка: Альбом' })).toHaveAttribute('src', 'https://example.test/1000x1000')
  fireEvent.error(screen.getByRole('img', { name: 'Обложка: Альбом' }))
  expect(screen.getByRole('img', { name: 'Обложка: Альбом' })).toHaveAttribute('src', 'https://example.test/400x400')
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть обложку' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(play).not.toHaveBeenCalled()
  fireEvent.keyDown(trigger, { key: 'Enter' })
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
