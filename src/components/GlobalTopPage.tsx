import { CalendarDays, Disc3, Globe2, LoaderCircle, Play, Radio, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { usePlayer } from '../player/PlayerContext'
import type { GlobalTopPayload } from '../types'
import { CoverArt } from './CoverArt'
import { TrackRow } from './TrackRow'

function editionLabel(value: string) {
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date)
}

export function GlobalTopPage({ data, loading, error }: { data?: GlobalTopPayload; loading: boolean; error?: string }) {
  const player = usePlayer()
  const [genreId, setGenreId] = useState('')
  useEffect(() => {
    if (!data?.genres.some((genre) => genre.id === genreId)) setGenreId(data?.genres[0]?.id || '')
  }, [data, genreId])
  const selectedGenre = useMemo(
    () => data?.genres.find((genre) => genre.id === genreId) || data?.genres[0],
    [data, genreId],
  )

  if (loading) return <div className="global-top-state"><LoaderCircle className="spin" size={26} /><span>Собираем мировой чарт и свежие релизы…</span></div>
  if (error || !data) return <div className="global-top-state global-top-state--error"><Globe2 size={28} /><strong>Глобальный топ пока недоступен</strong><span>{error || 'Каталог ещё не подключён.'}</span></div>

  return (
    <section className="global-top-page">
      <header className="global-top-hero">
        <div>
          <span className="eyebrow"><Globe2 size={14} /> МИРОВОЙ ЧАРТ · ОБНОВЛЯЕТСЯ ЕЖЕДНЕВНО</span>
          <h1>Топ <em>глобальный</em></h1>
          <p>{data.chartDescription || 'Главные треки мира, новые релизы и жанровые маршруты — всё в одном месте для поиска новой музыки.'}</p>
          <div className="global-top-hero__actions">
            <button className="primary-button" type="button" disabled={!data.chart.length} onClick={() => player.playQueue(data.chart)}><Play size={18} fill="currentColor" /> Слушать мировой топ</button>
            <span><CalendarDays size={16} /> Выпуск за {editionLabel(data.editionDate)}</span>
          </div>
        </div>
        <div className="global-top-hero__pulse" aria-hidden="true">
          <span><Globe2 size={38} /></span>
          <i /><i /><i />
          <strong>{data.chart.length}</strong>
          <small>позиций сегодня</small>
        </div>
      </header>

      <section className="global-top-section global-top-section--chart">
        <header><div><span className="eyebrow">СЕГОДНЯ В МИРЕ</span><h2>{data.chartTitle}</h2><p>Рейтинг на сегодня: нажмите на любую строку, чтобы начать с неё.</p></div><span className="global-top-section__badge"><Radio size={15} /> LIVE CHART</span></header>
        <div className="track-table">
          {data.chart.slice(0, 30).map((track, index) => <TrackRow key={`global-${track.id}`} track={track} context={data.chart} index={index} />)}
        </div>
      </section>

      {Boolean(data.releases.length) && <section className="global-top-section">
        <header><div><span className="eyebrow">НОВОЕ ЗА ДЕНЬ</span><h2>Свежие релизы</h2><p>Альбомы и синглы, которые только появились в каталоге.</p></div><Sparkles size={22} /></header>
        <div className="global-release-grid">
          {data.releases.slice(0, 10).map((release) => (
            <button key={release.id} className="global-release-card" type="button" disabled={!release.tracks.length} onClick={() => player.playQueue(release.tracks)} aria-label={`Слушать релиз ${release.title}`}>
              <span className="global-release-card__art"><CoverArt title={release.title} url={release.coverUrl} className="global-release-card__cover" /><i><Play size={19} fill="currentColor" /></i></span>
              <strong>{release.title}</strong>
              <small>{release.artists.join(', ')}</small>
              <em>{release.genre || 'Новый релиз'}</em>
            </button>
          ))}
        </div>
      </section>}

      {selectedGenre && <section className="global-top-section global-top-genres">
        <header><div><span className="eyebrow">ИСКАТЬ ПО ЗВУЧАНИЮ</span><h2>Топ по жанрам</h2><p>Переключайтесь между жанрами, которые сегодня заметны в мировом чарте.</p></div><Disc3 size={22} /></header>
        <div className="global-genre-tabs" role="tablist" aria-label="Жанры мирового чарта">
          {data.genres.map((genre) => <button key={genre.id} className={genre.id === selectedGenre.id ? 'is-active' : ''} type="button" role="tab" aria-selected={genre.id === selectedGenre.id} onClick={() => setGenreId(genre.id)}>{genre.title}<small>{genre.tracks.length}</small></button>)}
        </div>
        <div className="global-genre-panel" role="tabpanel">
          <div><span className="eyebrow">В ФОКУСЕ</span><h3>{selectedGenre.title}</h3><button className="secondary-button" type="button" disabled={!selectedGenre.tracks.length} onClick={() => player.playQueue(selectedGenre.tracks)}><Play size={16} fill="currentColor" /> Слушать жанр</button></div>
          <div className="track-table">
            {selectedGenre.tracks.map((track, index) => <TrackRow key={`${selectedGenre.id}-${track.id}`} track={track} context={selectedGenre.tracks} index={index} compact />)}
          </div>
        </div>
      </section>}
    </section>
  )
}
