import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtistLinks, artistSearchHref } from './ArtistLinks'

describe('artist search links', () => {
  afterEach(() => {
    cleanup()
    window.history.replaceState(null, '', '/')
  })

  it('builds a separate encoded search link for every artist', () => {
    render(<ArtistLinks artists={['Леонид Агутин', 'Artist & Friend']} />)

    expect(screen.getByRole('link', { name: 'Леонид Агутин' })).toHaveAttribute('href', artistSearchHref('Леонид Агутин'))
    expect(screen.getByRole('link', { name: 'Artist & Friend' })).toHaveAttribute('href', '/search?q=Artist%20%26%20Friend')
  })

  it('does not trigger a surrounding track action', () => {
    const onTrack = vi.fn()
    window.history.replaceState(null, '', '/')
    render(<div onClick={onTrack}><ArtistLinks artists={['Исполнитель']} /></div>)

    fireEvent.click(screen.getByRole('link', { name: 'Исполнитель' }))
    expect(onTrack).not.toHaveBeenCalled()
    expect(`${window.location.pathname}${window.location.search}`).toBe(artistSearchHref('Исполнитель'))
  })

  it('uses in-app search navigation from a public share page', () => {
    window.history.replaceState(null, '', '/share/public-share-token-123456?t=83')
    render(<ArtistLinks artists={['Исполнитель']} />)

    fireEvent.click(screen.getByRole('link', { name: 'Исполнитель' }))

    expect(`${window.location.pathname}${window.location.search}`).toBe(artistSearchHref('Исполнитель'))
  })
})
