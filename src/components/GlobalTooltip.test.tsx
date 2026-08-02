import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { clampTooltipX, GlobalTooltip } from './GlobalTooltip'

afterEach(cleanup)

describe('GlobalTooltip', () => {
  it('shows a custom hint for an icon-only button from its accessible label', () => {
    render(<><button aria-label="Открыть очередь">≡</button><GlobalTooltip /></>)
    fireEvent.pointerOver(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Открыть очередь')
  })

  it('uses visible text for ordinary buttons', () => {
    render(<><button>Слушать подборку</button><GlobalTooltip /></>)
    fireEvent.pointerOver(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Слушать подборку')
  })

  it('keeps a wide hint inside both viewport edges', () => {
    expect(clampTooltipX(14, 300, 1000)).toBe(160)
    expect(clampTooltipX(986, 300, 1000)).toBe(840)
    expect(clampTooltipX(500, 300, 1000)).toBe(500)
  })
})
