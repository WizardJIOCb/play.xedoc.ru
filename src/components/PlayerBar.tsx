import { Heart, ListMusic, Pause, Play, Repeat2, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import { usePlayer } from '../player/PlayerContext'
import { CoverArt } from './CoverArt'
import { ArtistLinks } from './ArtistLinks'
import { ShareButton } from './ShareButton'
import { PlaylistPicker } from './PlaylistPicker'
import { useAuthPrompt } from '../auth/AuthPromptContext'

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

export function PlayerBar({ onQueue, readonly = false }: { onQueue: () => void; readonly?: boolean }) {
  const player = usePlayer()
  const auth = useAuthPrompt()
  const [liking, setLiking] = useState(false)
  const track = player.current
  const liked = track ? player.isTrackLiked(track) : false
  const sourceStatus = track
    ? [player.isRemotePlayback ? 'Играет в другой вкладке' : player.isPlaying ? 'Играет' : 'Пауза', player.playbackSource?.playlistTitle].filter(Boolean).join(' · ')
    : undefined

  const onLike = async () => {
    if (!track || liking) return
    if (!auth.requireAuth()) return
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
    <footer className={`player-bar ${track ? 'player-bar--ready' : ''} ${readonly ? 'player-bar--readonly' : ''}`}>
      <div className="player-bar__track">
        <CoverArt title={track?.title || 'XEDOC'} url={track?.coverUrl} tone={track?.coverTone || 'mono'} className="player-bar__cover" />
        <div>
          <strong>{track?.title || 'Выберите музыку'}</strong>
          {track ? <ArtistLinks artists={track.artists} /> : <span>Плейлисты и рекомендации ждут вас</span>}
          {sourceStatus && <span className="player-bar__source-status" aria-live="polite">{sourceStatus}</span>}
        </div>
      </div>

      <div className="player-bar__center">
        <div className="player-bar__controls">
          <button className={`icon-button ${player.shuffle ? 'is-active' : ''}`} type="button" onClick={player.toggleShuffle} aria-label="Перемешать" disabled={player.isRemotePlayback}><Shuffle size={17} /></button>
          <button className="icon-button" type="button" onClick={player.previous} aria-label="Предыдущий" disabled={player.isRemotePlayback}><SkipBack size={20} fill="currentColor" /></button>
          <button className="player-bar__play" type="button" onClick={player.togglePlayback} aria-label={player.isPlaying ? 'Пауза' : 'Воспроизвести'} disabled={!track}>
            {player.isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
          </button>
          <button className="icon-button" type="button" onClick={player.next} aria-label="Следующий" disabled={player.isRemotePlayback}><SkipForward size={20} fill="currentColor" /></button>
          <button className={`icon-button ${player.repeat ? 'is-active' : ''}`} type="button" onClick={player.toggleRepeat} aria-label="Повтор" disabled={player.isRemotePlayback}><Repeat2 size={17} /></button>
        </div>
        <div className="player-bar__timeline">
          <span>{formatTime(player.progress)}</span>
          <input type="range" min="0" max={Math.max(player.duration, 1)} step="0.1" value={Math.min(player.progress, player.duration || 1)} onChange={(event) => player.seek(Number(event.target.value))} style={{ '--range-value': `${player.duration ? (player.progress / player.duration) * 100 : 0}%` } as React.CSSProperties} aria-label="Позиция воспроизведения" disabled={player.isRemotePlayback} />
          <span>{formatTime(player.duration)}</span>
          <div className="volume-control">
            {player.volume === 0 ? <VolumeX size={17} /> : player.volume < 0.5 ? <Volume1 size={17} /> : <Volume2 size={17} />}
            <input type="range" min="0" max="1" step="0.01" value={player.volume} onChange={(event) => player.setVolume(Number(event.target.value))} style={{ '--range-value': `${player.volume * 100}%` } as React.CSSProperties} aria-label="Громкость" disabled={player.isRemotePlayback} />
          </div>
        </div>
      </div>

      <div className="player-bar__tools">
        {!readonly && <button className={`icon-button ${liked ? 'is-liked' : ''}`} type="button" aria-label={liked ? 'Убрать лайк' : 'Поставить лайк'} disabled={!track || liking} onClick={() => void onLike()}><Heart size={18} fill={liked ? 'currentColor' : 'none'} /></button>}
        {!readonly && track && <ShareButton track={track} startAtSeconds={player.progress} />}
        {!readonly && track && !player.isRemotePlayback && <PlaylistPicker track={track} onAddNext={() => player.addNext(track)} />}
        {!readonly && <button className="icon-button" type="button" onClick={onQueue} aria-label="Очередь"><ListMusic size={19} /></button>}
      </div>
    </footer>
  )
}
