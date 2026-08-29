import { Fragment } from 'react'
import type { MouseEvent } from 'react'
import { navigateApp } from '../lib/navigation'

export function artistSearchHref(artist: string) {
  return `/search?q=${encodeURIComponent(artist)}`
}

export function ArtistLinks({ artists, className = '' }: { artists: string[]; className?: string }) {
  const openSearch = (event: MouseEvent<HTMLAnchorElement>, artist: string) => {
    event.stopPropagation()
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigateApp(artistSearchHref(artist))
  }

  return (
    <span className={`artist-links ${className}`} aria-label={`Исполнители: ${artists.join(', ')}`}>
      {artists.map((artist, index) => (
        <Fragment key={`${artist}-${index}`}>
          {index > 0 && ', '}
          <a href={artistSearchHref(artist)} onClick={(event) => openSearch(event, artist)} title={`Найти музыку исполнителя ${artist}`}>{artist}</a>
        </Fragment>
      ))}
    </span>
  )
}
