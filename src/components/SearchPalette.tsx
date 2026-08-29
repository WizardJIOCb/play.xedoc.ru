import { ArrowDownToLine, Clock3, Command, CornerDownLeft, LoaderCircle, Play, Search, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { searchMusic } from '../lib/api'
import { trackGoal } from '../lib/analytics'
import { navigateApp } from '../lib/navigation'
import { usePlayer } from '../player/PlayerContext'
import type { Playlist, SearchPayload, Track } from '../types'
import { CoverArt } from './CoverArt'
import { ArtistLinks } from './ArtistLinks'
import { PlaylistPicker } from './PlaylistPicker'

const emptyResults = (): SearchPayload => ({ tracks: [], playlists: [], profiles: [] })

export function SearchPalette({ suggestions, onPlaylistPlay, publicMode = false }: { suggestions: Track[]; onPlaylistPlay: (playlist: Playlist) => void; publicMode?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<SearchPayload>(emptyResults)
  const requestRef = useRef(0)
  const player = usePlayer()

  useEffect(() => {
    trackGoal('search_opened')
    window.setTimeout(() => inputRef.current?.focus(), 40)
  }, [])

  useEffect(() => {
    const syncQuery = () => setQuery(new URLSearchParams(window.location.search).get('q') || '')
    window.addEventListener('popstate', syncQuery)
    return () => window.removeEventListener('popstate', syncQuery)
  }, [])

  useEffect(() => {
    if (window.location.pathname.replace(/\/+$/, '') !== '/search') return
    const url = new URL(window.location.href)
    if (query.trim()) url.searchParams.set('q', query)
    else url.searchParams.delete('q')
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }, [query])

  useEffect(() => {
    if (!query.trim()) {
      requestRef.current += 1
      setResults(emptyResults())
      setLoading(false)
      setError('')
      return
    }
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    const timeout = window.setTimeout(() => {
      void searchMusic(query.trim())
        .then((payload) => requestId === requestRef.current && setResults(payload))
        .catch(() => {
          if (requestId !== requestRef.current) return
          setResults(emptyResults())
          setError('Не удалось выполнить поиск. Проверьте соединение и попробуйте ещё раз.')
        })
        .finally(() => requestId === requestRef.current && setLoading(false))
    }, 240)
    return () => {
      window.clearTimeout(timeout)
      if (requestId === requestRef.current) requestRef.current += 1
    }
  }, [query])

  const tracks = query.trim() ? results.tracks : suggestions
  const playFirst = () => {
    if (tracks[0]) {
      trackGoal('search_result_selected', { resultType: 'track' })
      player.playTrack(tracks[0], tracks)
    } else if (results.playlists[0]) {
      trackGoal('search_result_selected', { resultType: 'playlist' })
      onPlaylistPlay(results.playlists[0])
    } else if (results.profiles?.[0]) {
      trackGoal('search_result_selected', { resultType: 'profile' })
      navigateApp(`/users/${encodeURIComponent(results.profiles[0].username)}`)
    }
  }

  return (
    <section className="search-page" aria-label="Поиск музыки">
      <header className="search-page__heading">
        <div>
          <span className="eyebrow">{publicMode ? 'ПУБЛИЧНЫЙ ПОИСК XEDOC' : 'ПОИСК ПО ВСЕЙ МУЗЫКЕ'}</span>
          <h1>Что хотите послушать?</h1>
          <p>{publicMode ? 'Находите и слушайте треки прямо в браузере — регистрация не нужна.' : 'Ищите треки, исполнителей, плейлисты и открытые профили в одном месте.'}</p>
        </div>
      </header>

      <div className="search-page__surface">
        <div className="search-page__input">
          {loading ? <LoaderCircle className="spin" size={22} /> : <Search size={22} />}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && playFirst()}
            placeholder="Трек, артист, плейлист или @профиль"
            aria-label="Поисковый запрос"
          />
          {query && <button className="icon-button" type="button" onClick={() => setQuery('')} aria-label="Очистить поиск" data-tooltip="Очистить запрос"><X size={18} /></button>}
        </div>

        <div className="search-page__content" aria-live="polite">
          <div className="search-page__caption">
            <span>{query.trim() ? 'Треки' : publicMode ? 'Начните с запроса' : 'Можно включить сразу'}</span>
            {!query.trim() && <small><Clock3 size={13} /> {publicMode ? 'без регистрации' : 'быстрый выбор'}</small>}
          </div>
          <div className="search-results">
            {tracks.slice(0, 12).map((track) => (
              <div key={track.id} className={`search-result ${publicMode ? 'search-result--public' : ''}`}>
                <div className="search-result__main" role="button" tabIndex={0} aria-label={`Включить ${track.title}`} onClick={() => { trackGoal('search_result_selected', { resultType: 'track' }); player.playTrack(track, tracks) }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); trackGoal('search_result_selected', { resultType: 'track' }); player.playTrack(track, tracks) } }}>
                  <CoverArt title={track.title} url={track.coverUrl} tone={track.coverTone} className="search-result__cover" />
                  <span className="search-result__meta"><strong>{track.title}</strong><ArtistLinks artists={track.artists} /></span>
                  <Play size={17} fill="currentColor" />
                </div>
                {!publicMode && <PlaylistPicker track={track} onAddNext={() => player.addNext(track)} className="search-result__picker" />}
              </div>
            ))}
            {error && <div className="search-empty search-empty--error"><ArrowDownToLine size={24} /><p>{error}</p></div>}
            {publicMode && !query.trim() && <div className="search-empty"><Search size={24} /><p>Введите название трека или имя исполнителя.</p></div>}
            {query.trim() && !loading && !error && tracks.length === 0 && results.playlists.length === 0 && (results.profiles || []).length === 0 && <div className="search-empty"><ArrowDownToLine size={24} /><p>Ничего не нашли. Проверьте имя, логин или название музыки.</p></div>}
          </div>

          {!publicMode && results.playlists.length > 0 && (
            <div className="search-page__playlists">
              <div className="search-page__caption"><span>Плейлисты</span></div>
              <div className="search-playlist-row">
                {results.playlists.slice(0, 6).map((playlist) => (
                  <button key={playlist.id} type="button" onClick={() => { trackGoal('search_result_selected', { resultType: 'playlist' }); onPlaylistPlay(playlist) }}>
                    <CoverArt title={playlist.title} url={playlist.coverUrl} tone={playlist.coverTone} className="search-playlist-row__cover" />
                    <span><strong>{playlist.title}</strong><small>{playlist.trackCount} треков</small></span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {(results.profiles || []).length > 0 && (
            <div className="search-page__profiles">
              <div className="search-page__caption"><span>Профили</span></div>
              <div className="search-profile-row">
                {results.profiles.slice(0, 6).map((profile) => (
                  <a key={profile.username} href={`/users/${encodeURIComponent(profile.username)}`} onClick={() => trackGoal('search_result_selected', { resultType: 'profile' })}>
                    <span className="search-profile-row__avatar"><UserRound size={20} /></span>
                    <span><strong>{profile.displayName}</strong><small>@{profile.username} · {profile.publicPlaylistCount} публичных плейлистов</small></span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
        <footer className="search-page__footer">
          <span>{publicMode ? <><Search size={14} /> поиск доступен всем</> : <><Command size={14} /> K — перейти к поиску</>}</span>
          <span><CornerDownLeft size={14} /> — включить первый результат</span>
        </footer>
      </div>
    </section>
  )
}
