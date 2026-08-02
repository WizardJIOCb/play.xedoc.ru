import { Play } from 'lucide-react'
import { usePlayer } from '../player/PlayerContext'
import type { Playlist } from '../types'
import { CoverArt } from './CoverArt'

function trackCountLabel(count: number) {
  const remainder100 = count % 100
  const remainder10 = count % 10
  if (remainder100 >= 11 && remainder100 <= 14) return `${count} треков`
  if (remainder10 === 1) return `${count} трек`
  if (remainder10 >= 2 && remainder10 <= 4) return `${count} трека`
  return `${count} треков`
}

export function PlaylistCard({ playlist, wide = false, onOpen, onPlay }: { playlist: Playlist; wide?: boolean; onOpen?: (playlist: Playlist) => void; onPlay?: (playlist: Playlist) => void }) {
  const player = usePlayer()
  const play = () => {
    if (playlist.tracks?.length) player.playQueue(playlist.tracks)
    else onPlay?.(playlist)
  }

  return (
    <article className={`playlist-card ${wide ? 'playlist-card--wide' : ''}`} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} onClick={() => onOpen?.(playlist)} onKeyDown={(event) => { if (onOpen && (event.key === 'Enter' || event.key === ' ')) onOpen(playlist) }}>
      <CoverArt title={playlist.title} url={playlist.coverUrl} tone={playlist.coverTone} className="playlist-card__cover" playable onPlay={play} />
      <div className="playlist-card__body">
        <div>
          <h3>{playlist.title}</h3>
          {playlist.subtitle && <p>{playlist.subtitle}</p>}
          <span className="playlist-card__count">{trackCountLabel(playlist.trackCount)}</span>
        </div>
      </div>
      {wide && (
        <button className="playlist-card__wide-play" type="button" onClick={(event) => { event.stopPropagation(); play() }}>
          <Play size={16} fill="currentColor" /> Слушать
        </button>
      )}
    </article>
  )
}
