import { ArrowDownToLine, Clock3, Command, CornerDownLeft, ListPlus, LoaderCircle, Play, Search, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { searchMusic } from '../lib/api'
import { usePlayer } from '../player/PlayerContext'
import type { Playlist, SearchPayload, Track } from '../types'
import { CoverArt } from './CoverArt'

export function SearchPalette({ open, suggestions, onClose, onPlaylistPlay }: { open: boolean; suggestions: Track[]; onClose: () => void; onPlaylistPlay: (playlist: Playlist) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchPayload>({ tracks: [], playlists: [], profiles: [] })
  const requestRef = useRef(0)
  const player = usePlayer()

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 40)
    else {
      requestRef.current += 1
      setQuery('')
      setLoading(false)
    }
  }, [open])

  useEffect(() => {
    if (!query.trim()) {
      requestRef.current += 1
      setResults({ tracks: [], playlists: [], profiles: [] })
      setLoading(false)
      return
    }
    const requestId = ++requestRef.current
    setLoading(true)
    const timeout = window.setTimeout(() => {
      void searchMusic(query)
        .then((payload) => requestId === requestRef.current && setResults(payload))
        .catch(() => requestId === requestRef.current && setResults({ tracks: [], playlists: [], profiles: [] }))
        .finally(() => requestId === requestRef.current && setLoading(false))
    }, 240)
    return () => {
      window.clearTimeout(timeout)
      if (requestId === requestRef.current) requestRef.current += 1
    }
  }, [query])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose, open])

  if (!open) return null
  const tracks = query ? results.tracks : suggestions

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="search-palette" role="dialog" aria-modal="true" aria-label="Поиск музыки">
        <div className="search-palette__input">
          {loading ? <LoaderCircle className="spin" size={21} /> : <Search size={21} />}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              if (tracks[0]) player.playTrack(tracks[0], tracks)
              else if (results.playlists[0]) onPlaylistPlay(results.playlists[0])
              else if (results.profiles?.[0]) window.location.href = `/users/${encodeURIComponent(results.profiles[0].username)}`
              else return
              onClose()
            }}
            placeholder="Трек, артист, плейлист или @профиль"
          />
          <kbd>ESC</kbd>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button>
        </div>

        <div className="search-palette__content">
          <div className="search-palette__caption">
            <span>{query ? 'Треки' : 'Недавно слушали'}</span>
            {!query && <small><Clock3 size={13} /> локальная история</small>}
          </div>
          <div className="search-results">
            {tracks.slice(0, 6).map((track) => (
              <div key={track.id} className="search-result">
                <button className="search-result__main" type="button" onClick={() => { player.playTrack(track, tracks); onClose() }}>
                  <CoverArt title={track.title} url={track.coverUrl} tone={track.coverTone} className="search-result__cover" />
                  <span className="search-result__meta"><strong>{track.title}</strong><small>{track.artists.join(', ')}</small></span>
                  <Play size={17} fill="currentColor" />
                </button>
                <button className="search-result__next" type="button" aria-label={`Добавить ${track.title} следующим`} onClick={() => player.addNext(track)}><ListPlus size={18} /></button>
              </div>
            ))}
            {query && !loading && tracks.length === 0 && results.playlists.length === 0 && (results.profiles || []).length === 0 && <div className="search-empty"><ArrowDownToLine size={24} /><p>Ничего не нашли. Проверьте имя, логин или название музыки.</p></div>}
          </div>

          {results.playlists.length > 0 && (
            <div className="search-palette__playlists">
              <div className="search-palette__caption"><span>Плейлисты</span></div>
              <div className="search-playlist-row">
                {results.playlists.slice(0, 4).map((playlist) => (
                  <button key={playlist.id} type="button" onClick={() => { onPlaylistPlay(playlist); onClose() }}>
                    <CoverArt title={playlist.title} url={playlist.coverUrl} tone={playlist.coverTone} className="search-playlist-row__cover" />
                    <span><strong>{playlist.title}</strong><small>{playlist.trackCount} треков</small></span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {(results.profiles || []).length > 0 && (
            <div className="search-palette__profiles">
              <div className="search-palette__caption"><span>Профили</span></div>
              <div className="search-profile-row">
                {results.profiles.slice(0, 6).map((profile) => (
                  <a key={profile.username} href={`/users/${encodeURIComponent(profile.username)}`} onClick={onClose}>
                    <span className="search-profile-row__avatar"><UserRound size={20} /></span>
                    <span><strong>{profile.displayName}</strong><small>@{profile.username} · {profile.publicPlaylistCount} публичных плейлистов</small></span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
        <footer className="search-palette__footer">
          <span><Command size={14} /> K — открыть поиск</span>
          <span><CornerDownLeft size={14} /> — включить</span>
        </footer>
      </section>
    </div>
  )
}
