import { Volume1, Volume2, VolumeX } from 'lucide-react'
import type { CSSProperties } from 'react'
import { usePlayer } from '../player/PlayerContext'
import type { Track } from '../types'

export function TrackPlaybackControls({ track, className = '' }: { track: Track; className?: string }) {
  const player = usePlayer()
  const fallbackDuration = Number.isFinite(track.durationMs) ? Math.max(0, track.durationMs / 1000) : 0
  const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : fallbackDuration
  const progress = Number.isFinite(player.progress) ? Math.min(Math.max(0, player.progress), duration) : 0
  const volume = Math.round(player.volume * 100)

  return <div className={`track-playback ${className}`} role="group" aria-label={`Управление треком ${track.title}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <input className="track-playback__seek" type="range" min="0" max={duration || 1} step="1" value={progress} disabled={!duration}
      aria-label={`Перемотка ${track.title}`} aria-valuetext={`${Math.floor(progress / 60)}:${String(Math.floor(progress % 60)).padStart(2, '0')} из ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`}
      onChange={(event) => player.seek(Number(event.target.value))} style={{ '--range-value': `${duration ? progress / duration * 100 : 0}%` } as CSSProperties} />
    <label className="track-playback__volume" title={`Громкость ${volume}%`}>
      {player.volume === 0 ? <VolumeX size={16} /> : player.volume < .5 ? <Volume1 size={16} /> : <Volume2 size={16} />}
      <input type="range" min="0" max="1" step="0.01" value={player.volume} aria-label={`Громкость ${track.title}`} aria-valuetext={`${volume}%`}
        onChange={(event) => player.setVolume(Number(event.target.value))} style={{ '--range-value': `${volume}%` } as CSSProperties} />
    </label>
  </div>
}
