import { describe, expect, it } from 'vitest'
import type { Track } from './types'
import { filterCollectionTracks, stabilizeTrackOrder } from './App'

const liked: Track = { id: 'liked', title: 'Liked', artists: ['Artist'], durationMs: 180_000, liked: true }
const removed: Track = { id: 'removed', title: 'Removed', artists: ['Artist'], durationMs: 180_000, liked: false }

describe('favorite collection filtering', () => {
  it('removes unliked tracks from favorites but preserves complete history', () => {
    expect(filterCollectionTracks('liked', [liked, removed], (track) => Boolean(track.liked))).toEqual([liked])
    expect(filterCollectionTracks('history', [liked, removed], () => false)).toEqual([liked, removed])
  })

  it('keeps history rows stable while tracks receive newer timestamps', () => {
    const initial = stabilizeTrackOrder([], [liked, removed])
    const updated = stabilizeTrackOrder(initial.order, [removed, liked])

    expect(updated.tracks.map((track) => track.id)).toEqual(['liked', 'removed'])
  })
})
