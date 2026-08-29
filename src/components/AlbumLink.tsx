import type { MouseEvent } from 'react'
import { navigateApp } from '../lib/navigation'
import type { Track } from '../types'

export function albumHref(track: Pick<Track, 'album' | 'albumId' | 'artists'>) {
  if (!track.album) return ''
  const params = new URLSearchParams({ title: track.album })
  if (track.artists[0]) params.set('artist', track.artists[0])
  if (track.albumId) params.set('id', track.albumId)
  return `/album?${params}`
}

export function AlbumLink({ track }: { track: Track }) {
  const href = albumHref(track)
  if (!href) return <span className="track-row__album" />

  const openAlbum = (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation()
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigateApp(href)
  }

  return (
    <a className="track-row__album track-row__album-link" href={href} onClick={openAlbum} title={`Открыть альбом ${track.album}`}>
      {track.album}
    </a>
  )
}
