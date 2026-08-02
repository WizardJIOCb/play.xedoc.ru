import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MoodMap } from './MoodMap'

describe('MoodMap', () => {
  afterEach(() => cleanup())

  it('explains the selected direction with readable values', () => {
    render(<MoodMap onSession={() => undefined} />)
    expect(screen.getByText('Глубокий фокус')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Энергия: 42%' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Новизна: 28%' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Больше энергии' }))
    expect(screen.getByText('Энергичный разгон')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Энергия: 88%' })).toBeInTheDocument()
  })

  it('starts session setup from the selected direction block', () => {
    const onSession = vi.fn()
    render(<MoodMap onSession={onSession} />)
    fireEvent.click(screen.getByRole('button', { name: 'Настроить волну' }))
    expect(onSession).toHaveBeenCalledOnce()
  })
})
