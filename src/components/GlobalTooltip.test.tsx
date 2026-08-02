import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { clampTooltipX, GlobalTooltip } from './GlobalTooltip'

afterEach(cleanup)

describe('GlobalTooltip', () => {
  it('shows a custom hint for an icon-only button from its accessible label', () => {
    render(<><button aria-label="Открыть очередь"><svg aria-hidden="true" /></button><GlobalTooltip /></>)
    fireEvent.pointerOver(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Открыть очередь')
  })

  it('does not duplicate visible text for ordinary buttons', () => {
    render(<><button>Слушать подборку</button><GlobalTooltip /></>)
    fireEvent.pointerOver(screen.getByRole('button'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('keeps explicit explanations even when an indicator has text', () => {
    render(<><span data-tooltip="Учитывается после 20 секунд">12 прослушиваний</span><GlobalTooltip /></>)
    fireEvent.pointerOver(screen.getByText('12 прослушиваний'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Учитывается после 20 секунд')
  })

  it('keeps a wide hint inside both viewport edges', () => {
    expect(clampTooltipX(14, 300, 1000)).toBe(160)
    expect(clampTooltipX(986, 300, 1000)).toBe(840)
    expect(clampTooltipX(500, 300, 1000)).toBe(500)
  })
})
