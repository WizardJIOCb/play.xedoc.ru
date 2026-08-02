import { Headphones, Heart, Pause, Play } from 'lucide-react'
import { useState } from 'react'
import { usePlayer, type PlaybackSource } from '../player/PlayerContext'
import type { Track } from '../types'
import { CoverArt } from './CoverArt'
import { ArtistLinks } from './ArtistLinks'
import { ShareButton } from './ShareButton'
import { PlaylistPicker } from './PlaylistPicker'

function formatDuration(durationMs: number) {
  const total = Math.round(durationMs / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function TrackRow({ track, context, index, compact = false, readonly = false, playbackSource }: { track: Track; context: Track[]; index?: number; compact?: boolean; readonly?: boolean; playbackSource?: PlaybackSource }) {
  const player = usePlayer()
  const contextIndex = context.findIndex((item) => item === track)
  const active = context === player.queue && contextIndex >= 0
    ? player.currentIndex === contextIndex
    : player.current?.id === track.id
  const liked = player.isTrackLiked(track)
  const [liking, setLiking] = useState(false)

  const onLike = async () => {
    if (liking) return
    setLiking(true)
    try {
      await player.setTrackLiked(track, !liked)
    } catch {
      // PlayerContext restores the optimistic value.
    } finally {
      setLiking(false)
    }
  }

  return (
    <div className={`track-row ${active ? 'track-row--active' : ''} ${compact ? 'track-row--compact' : ''} ${readonly ? 'track-row--readonly' : ''}`}>
      <button className="track-row__play" type="button" aria-label={active && player.isPlaying ? 'Пауза' : `Включить ${track.title}`} onClick={() => active ? player.togglePlayback() : player.playTrack(track, context, contextIndex >= 0 ? contextIndex : index, playbackSource)}>
        <span className="track-row__index">{index === undefined ? <Play size={15} fill="currentColor" /> : index + 1}</span>
        <span className="track-row__control">{active && player.isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</span>
      </button>
      <CoverArt title={track.title} url={track.coverUrl} tone={track.coverTone} className="track-row__cover" />
      <div className="track-row__meta">
        <span className="track-row__title-line"><strong>{track.title}</strong>{Boolean(track.playCount) && <span className="track-row__plays" data-tooltip={`${track.playCount} прослушиваний · учтено после 20 секунд воспроизведения`}><Headphones size={11} /> {track.playCount}</span>}</span>
        <ArtistLinks artists={track.artists} />
      </div>
      {!compact && <span className="track-row__album">{track.album}</span>}
      {!readonly && <button className={`icon-button track-row__like ${liked ? 'is-liked' : ''}`} type="button" aria-label={liked ? 'Убрать лайк' : 'Поставить лайк'} disabled={liking} onClick={() => void onLike()}>
        <Heart size={17} fill={liked ? 'currentColor' : 'none'} />
      </button>}
      <span className="track-row__duration">{formatDuration(track.durationMs)}</span>
      {!readonly && <ShareButton track={track} className="track-row__more" />}
      {!readonly && <PlaylistPicker track={track} onAddNext={() => player.addNext(track)} className="track-row__next" />}
    </div>
  )
}
