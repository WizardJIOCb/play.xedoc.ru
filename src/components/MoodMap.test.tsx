import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MoodMap } from './MoodMap'

describe('MoodMap', () => {
  afterEach(() => cleanup())

  it('explains the selected direction with readable values', () => {
    render(<MoodMap onSession={() => undefined} />)
    expect(screen.getByText('Глубокий фокус')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Энергия' })).toHaveValue('42')
    expect(screen.getByRole('slider', { name: 'Новизна' })).toHaveValue('28')
    fireEvent.click(screen.getByRole('button', { name: 'Больше энергии' }))
    expect(screen.getByText('Энергичный разгон')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Энергия' })).toHaveValue('88')
  })

  it('switches to a custom direction when a slider is adjusted', () => {
    render(<MoodMap onSession={() => undefined} />)
    fireEvent.change(screen.getByRole('slider', { name: 'Энергия' }), { target: { value: '76' } })
    expect(screen.getByText('РУЧНАЯ НАСТРОЙКА')).toBeInTheDocument()
    expect(screen.getByText('Яркий знакомый ритм')).toBeInTheDocument()
    expect(screen.getByText('76% энергии')).toBeInTheDocument()
  })

  it('starts session setup from the selected direction block', () => {
    const onSession = vi.fn()
    render(<MoodMap onSession={onSession} />)
    fireEvent.change(screen.getByRole('slider', { name: 'Новизна' }), { target: { value: '73' } })
    fireEvent.click(screen.getByRole('button', { name: 'Настроить волну' }))
    expect(onSession).toHaveBeenCalledWith({ energy: 42, novelty: 73 })
  })
})
