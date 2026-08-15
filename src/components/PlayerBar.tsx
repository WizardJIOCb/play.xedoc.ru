import { Heart, ListMusic, Pause, Play, Repeat2, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import { usePlayer } from '../player/PlayerContext'
import { CoverArt } from './CoverArt'
import { ArtistLinks } from './ArtistLinks'
import { ShareButton } from './ShareButton'
import { PlaylistPicker } from './PlaylistPicker'

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

export function PlayerBar({ onQueue, readonly = false }: { onQueue: () => void; readonly?: boolean }) {
  const player = usePlayer()
  const [liking, setLiking] = useState(false)
  const track = player.current
  const liked = track ? player.isTrackLiked(track) : false

  const onLike = async () => {
    if (!track || liking) return
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
        <div><strong>{track?.title || 'Выберите музыку'}</strong>{track ? <ArtistLinks artists={track.artists} /> : <span>Плейлисты и рекомендации ждут вас</span>}</div>
      </div>

      <div className="player-bar__center">
        <div className="player-bar__controls">
          <button className={`icon-button ${player.shuffle ? 'is-active' : ''}`} type="button" onClick={player.toggleShuffle} aria-label="Перемешать"><Shuffle size={17} /></button>
          <button className="icon-button" type="button" onClick={player.previous} aria-label="Предыдущий"><SkipBack size={20} fill="currentColor" /></button>
          <button className="player-bar__play" type="button" onClick={player.togglePlayback} aria-label={player.isPlaying ? 'Пауза' : 'Воспроизвести'} disabled={!track}>
            {player.isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
          </button>
          <button className="icon-button" type="button" onClick={player.next} aria-label="Следующий"><SkipForward size={20} fill="currentColor" /></button>
          <button className={`icon-button ${player.repeat ? 'is-active' : ''}`} type="button" onClick={player.toggleRepeat} aria-label="Повтор"><Repeat2 size={17} /></button>
        </div>
        <div className="player-bar__timeline">
          <span>{formatTime(player.progress)}</span>
          <input type="range" min="0" max={Math.max(player.duration, 1)} step="0.1" value={Math.min(player.progress, player.duration || 1)} onChange={(event) => player.seek(Number(event.target.value))} style={{ '--range-value': `${player.duration ? (player.progress / player.duration) * 100 : 0}%` } as React.CSSProperties} aria-label="Позиция воспроизведения" />
          <span>{formatTime(player.duration)}</span>
        </div>
      </div>

      <div className="player-bar__tools">
        {!readonly && <button className={`icon-button ${liked ? 'is-liked' : ''}`} type="button" aria-label={liked ? 'Убрать лайк' : 'Поставить лайк'} disabled={!track || liking} onClick={() => void onLike()}><Heart size={18} fill={liked ? 'currentColor' : 'none'} /></button>}
        {!readonly && track && <ShareButton track={track} />}
        {!readonly && track && <PlaylistPicker track={track} onAddNext={() => player.addNext(track)} />}
        {!readonly && <button className="icon-button" type="button" onClick={onQueue} aria-label="Очередь"><ListMusic size={19} /></button>}
        <div className="volume-control">
          {player.volume === 0 ? <VolumeX size={18} /> : player.volume < 0.5 ? <Volume1 size={18} /> : <Volume2 size={18} />}
          <input type="range" min="0" max="1" step="0.01" value={player.volume} onChange={(event) => player.setVolume(Number(event.target.value))} style={{ '--range-value': `${player.volume * 100}%` } as React.CSSProperties} aria-label="Громкость" />
        </div>
      </div>
    </footer>
  )
}
