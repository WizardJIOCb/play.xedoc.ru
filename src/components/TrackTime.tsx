import { usePlayer } from '../player/PlayerContext'
import type { Track } from '../types'

function formatTime(seconds: number) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function TrackTime({ track, active, className = '' }: { track: Track; active?: boolean; className?: string }) {
  const player = usePlayer()
  const current = active ?? player.current?.id === track.id
  const duration = current && Number.isFinite(player.duration) && player.duration > 0 ? player.duration : track.durationMs / 1000
  const elapsed = Math.min(Math.max(0, player.progress || 0), Math.max(0, duration))
  const value = current ? `${formatTime(elapsed)} / ${formatTime(duration)}` : formatTime(duration)
  return <span className={`track-time ${current ? 'track-time--current' : ''} ${className}`} aria-live="off" aria-label={current ? `Прошло ${formatTime(elapsed)} из ${formatTime(duration)}` : `Длительность ${value}`}>{value}</span>
}
