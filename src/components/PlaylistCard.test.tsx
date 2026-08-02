import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlayerProvider } from '../player/PlayerContext'
import type { Playlist } from '../types'
import { PlaylistCard } from './PlaylistCard'

describe('PlaylistCard', () => {
  it('requests playlist detail playback when a summary has no tracks', () => {
    const playlist: Playlist = {
      id: '42:7',
      title: 'Реальный плейлист',
      trackCount: 24,
    }
    const onPlay = vi.fn()

    render(
      <PlayerProvider>
        <PlaylistCard playlist={playlist} onPlay={onPlay} />
      </PlayerProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Включить Реальный плейлист' }))
    expect(onPlay).toHaveBeenCalledWith(playlist)
  })
})
