import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Playlist } from '../types'
import { Sidebar } from './Sidebar'

const recent: Playlist = {
  id: 'recent-one',
  title: 'Недавний плейлист',
  description: '',
  trackCount: 3,
  coverTone: 'violet',
}

describe('recent playlists sidebar', () => {
  afterEach(() => cleanup())

  it('opens a selected playlist while the section heading opens the library', () => {
    const onView = vi.fn()
    const onPlaylist = vi.fn()
    render(
      <Sidebar
        view="home"
        playlists={[recent]}
        collapsed={false}
        recommendationsActive={false}
        topActive={false}
        onView={onView}
        onRecommendations={() => undefined}
        onTop={() => undefined}
        onPlaylist={onPlaylist}
        onToggle={() => undefined}
        onSession={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Открыть плейлист Недавний плейлист' }))
    expect(onPlaylist).toHaveBeenCalledWith(recent)
    expect(onView).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Показать все плейлисты' }))
    expect(onView).toHaveBeenCalledWith('library')
  })
})
