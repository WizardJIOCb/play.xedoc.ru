import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MusicLoader } from './MusicLoader'

describe('MusicLoader', () => {
  it('announces the loading state while keeping its animation decorative', () => {
    render(<MusicLoader />)

    const loader = screen.getByRole('status', { name: 'Загружаем музыку' })
    expect(loader).toHaveTextContent('Ловим нужную волну')
    expect(loader).toHaveTextContent('Загружаем музыку')
    expect(loader.querySelector('.app-loader__visual')).toHaveAttribute('aria-hidden', 'true')
    expect(loader.querySelectorAll('.app-loader__vinyl')).toHaveLength(1)
    expect(loader.querySelector('.app-loader__tonearm')).not.toBeInTheDocument()
    expect(loader.querySelector('.app-loader__equalizer')).not.toBeInTheDocument()
  })
})
