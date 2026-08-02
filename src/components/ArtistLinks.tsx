import { Fragment } from 'react'
import type { MouseEvent } from 'react'

export function artistSearchHref(artist: string) {
  return `/search?q=${encodeURIComponent(artist)}`
}

export function ArtistLinks({ artists, className = '' }: { artists: string[]; className?: string }) {
  const openSearch = (event: MouseEvent<HTMLAnchorElement>, artist: string) => {
    event.stopPropagation()
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (/^\/(?:users|share)\//.test(window.location.pathname)) return
    event.preventDefault()
    const href = artistSearchHref(artist)
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.pushState(null, '', href)
    window.dispatchEvent(new PopStateEvent('popstate'))
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
