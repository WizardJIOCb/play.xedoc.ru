import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types'
import { AlbumLink, albumHref } from './AlbumLink'

const track: Track = {
  id: 'turtle',
  title: 'Turtle',
  artists: ['PILOTE', 'Bonobo'],
  album: '3 To The Floor',
  albumId: 'album-3',
  durationMs: 308_000,
}

describe('AlbumLink', () => {
  afterEach(() => {
    cleanup()
    window.history.replaceState(null, '', '/')
  })

  it('builds a copyable album URL with an exact id and fallback metadata', () => {
    expect(albumHref(track)).toBe('/album?title=3+To+The+Floor&artist=PILOTE&id=album-3')
  })

  it('opens inside the app without triggering the surrounding track row', () => {
    const onTrack = vi.fn()
    render(<div onClick={onTrack}><AlbumLink track={track} /></div>)

    fireEvent.click(screen.getByRole('link', { name: '3 To The Floor' }))

    expect(onTrack).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/album')
    expect(new URLSearchParams(window.location.search).get('id')).toBe('album-3')
  })
})
