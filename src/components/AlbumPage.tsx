import { Disc3, LoaderCircle, Play, Shuffle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getAlbum } from '../lib/api'
import { APP_NAVIGATE_EVENT } from '../lib/navigation'
import { usePlayer } from '../player/PlayerContext'
import type { GlobalRelease } from '../types'
import { ArtistLinks } from './ArtistLinks'
import { CoverArt } from './CoverArt'
import { TrackRow } from './TrackRow'

function albumRequest() {
  const params = new URLSearchParams(window.location.search)
  return {
    id: params.get('id') || undefined,
    title: params.get('title')?.trim() || '',
    artist: params.get('artist')?.trim() || undefined,
  }
}

function releaseYear(value?: string) {
  return value?.match(/^\d{4}/)?.[0]
}

function trackWord(count: number) {
  const tail = count % 100
  if (tail >= 11 && tail <= 14) return 'треков'
  if (count % 10 === 1) return 'трек'
  if (count % 10 >= 2 && count % 10 <= 4) return 'трека'
  return 'треков'
}

export function AlbumPage() {
  const player = usePlayer()
  const [routeKey, setRouteKey] = useState(() => window.location.search)
  const [album, setAlbum] = useState<GlobalRelease>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const request = useMemo(albumRequest, [routeKey])

  useEffect(() => {
    const onRouteChange = () => setRouteKey(window.location.search)
    window.addEventListener('popstate', onRouteChange)
    window.addEventListener(APP_NAVIGATE_EVENT, onRouteChange)
    return () => {
      window.removeEventListener('popstate', onRouteChange)
      window.removeEventListener(APP_NAVIGATE_EVENT, onRouteChange)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setAlbum(undefined)
    setError('')
    if (!request.title) {
      setLoading(false)
      setError('Не указано название альбома.')
      return
    }
    setLoading(true)
    void getAlbum(request)
      .then((result) => { if (!cancelled) setAlbum(result) })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить альбом.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [request])

  if (loading) return <div className="playlist-detail__loading album-page__state"><LoaderCircle className="spin" size={25} /> Загружаем альбом…</div>
  if (error || !album) return <div className="playlist-detail__loading album-page__state form-error"><Disc3 size={25} /> {error || 'Альбом не найден.'}</div>

  const year = releaseYear(album.releaseDate)
  const meta = [year, album.genre, `${album.tracks.length} ${trackWord(album.tracks.length)}`].filter(Boolean)
  return (
    <section className="playlist-detail album-page" aria-label={`Альбом ${album.title}`}>
      <header className="playlist-detail__hero album-page__hero">
        <CoverArt title={album.title} url={album.coverUrl} tone="violet" className="playlist-detail__cover" />
        <div className="playlist-detail__meta">
          <span className="eyebrow"><Disc3 size={14} /> АЛЬБОМ</span>
          <h1>{album.title}</h1>
          <ArtistLinks artists={album.artists} className="album-page__artists" />
          {meta.length > 0 && <p>{meta.join(' · ')}</p>}
          <div>
            <button className="primary-button" type="button" disabled={!album.tracks.length} onClick={() => player.playQueue(album.tracks)}><Play size={18} fill="currentColor" /> Слушать</button>
            <button className="secondary-button" type="button" disabled={!album.tracks.length} onClick={() => player.playQueue([...album.tracks].sort(() => Math.random() - 0.5))}><Shuffle size={18} /> Перемешать</button>
          </div>
        </div>
      </header>
      <div className="playlist-detail__summary album-page__summary">
        <span><Disc3 size={16} /> Полный список альбома</span>
        <p><strong>{album.artists.join(', ')}</strong>{year && <><i />{year}</>}</p>
      </div>
      <div className="track-table track-table--large">
        {album.tracks.map((track, index) => <TrackRow key={`${track.id}-${index}`} track={track} context={album.tracks} index={index} />)}
      </div>
      {!album.tracks.length && <div className="playlist-detail__loading">В альбоме пока нет доступных треков.</div>}
    </section>
  )
}
