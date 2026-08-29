import { Clock3, Disc3, Flame, Headphones, LoaderCircle, Play, Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getGlobalTopSection } from '../lib/api'
import { usePlayer } from '../player/PlayerContext'
import type { GenrePeriod, GlobalGenre, GlobalTopPayload, GlobalTopSection } from '../types'
import { CoverArt } from './CoverArt'
import { TrackRow } from './TrackRow'

type GenreScope = GlobalGenre['scope']

const PAGE_SIZE = 20

const scopes: Array<{ id: GenreScope; title: string }> = [
  { id: 'international', title: 'Зарубежные' },
  { id: 'russian', title: 'Русские' },
]

const periods: Array<{ id: GenrePeriod; title: string; hint: string }> = [
  { id: 'all', title: 'Всё время', hint: 'Весь редакционный топ' },
  { id: 'recent', title: '12 месяцев', hint: 'Свежие релизы' },
  { id: '2020s', title: '2020-е', hint: 'Текущее десятилетие' },
  { id: '2010s', title: '2010-е', hint: 'Прошлое десятилетие' },
  { id: 'classic', title: 'До 2010', hint: 'Проверенное временем' },
]

function GenreCard({ genre, active, onClick }: { genre: GlobalGenre; active: boolean; onClick: () => void }) {
  return (
    <button className={`genre-card ${active ? 'is-active' : ''}`} type="button" onClick={onClick} aria-pressed={active}>
      <span className="genre-card__covers" aria-hidden="true">
        {genre.tracks.slice(0, 3).map((track) => <CoverArt key={track.id} title={track.title} url={track.coverUrl} tone={track.coverTone} className="genre-card__cover" />)}
        {!genre.tracks.length && <span className="genre-card__fallback"><Disc3 size={22} /></span>}
      </span>
      <span><strong>{genre.title}</strong><small>{genre.sourceTitle || `${genre.tracks.length} треков в топе`}</small></span>
    </button>
  )
}

export function GenresPage({ data, loading, error }: { data?: GlobalTopPayload; loading: boolean; error?: string }) {
  const player = usePlayer()
  const [scope, setScope] = useState<GenreScope>('international')
  const [genreId, setGenreId] = useState('')
  const [period, setPeriod] = useState<GenrePeriod>('all')
  const [query, setQuery] = useState('')
  const [section, setSection] = useState<GlobalTopSection>()
  const [sectionLoading, setSectionLoading] = useState(false)
  const [sectionError, setSectionError] = useState('')

  const genresByScope = useMemo(() => ({
    international: data?.genres.filter((genre) => genre.scope === 'international') || [],
    russian: data?.genres.filter((genre) => genre.scope === 'russian') || [],
  }), [data])
  const scopedGenres = genresByScope[scope]
  const visibleGenres = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru-RU')
    return needle ? scopedGenres.filter((genre) => genre.title.toLocaleLowerCase('ru-RU').includes(needle)) : scopedGenres
  }, [query, scopedGenres])
  const selectedGenre = scopedGenres.find((genre) => genre.id === genreId) || scopedGenres[0]
  const selectedPeriod = periods.find((item) => item.id === period) || periods[0]

  useEffect(() => {
    if (selectedGenre && selectedGenre.id !== genreId) setGenreId(selectedGenre.id)
  }, [genreId, selectedGenre])

  useEffect(() => {
    if (!selectedGenre) return undefined
    let cancelled = false
    setSection(undefined)
    setSectionError('')
    setSectionLoading(true)
    void getGlobalTopSection('genre', selectedGenre.id, 0, PAGE_SIZE, period)
      .then((result) => { if (!cancelled) setSection(result) })
      .catch(() => { if (!cancelled) setSectionError('Не удалось загрузить музыку этого жанра.') })
      .finally(() => { if (!cancelled) setSectionLoading(false) })
    return () => { cancelled = true }
  }, [period, selectedGenre])

  const selectScope = (nextScope: GenreScope) => {
    setScope(nextScope)
    setGenreId(genresByScope[nextScope][0]?.id || '')
    setQuery('')
  }

  const loadMore = async () => {
    if (!selectedGenre || !section?.hasMore || sectionLoading) return
    setSectionLoading(true)
    setSectionError('')
    try {
      const next = await getGlobalTopSection('genre', selectedGenre.id, section.tracks.length, PAGE_SIZE, period)
      setSection((current) => current ? { ...next, offset: 0, tracks: [...current.tracks, ...next.tracks] } : next)
    } catch {
      setSectionError('Не удалось догрузить треки. Попробуйте ещё раз.')
    } finally {
      setSectionLoading(false)
    }
  }

  if (loading) return <div className="global-top-state"><LoaderCircle className="spin" size={26} /><span>Собираем карту жанров…</span></div>
  if (error || !data) return <div className="global-top-state global-top-state--error"><Disc3 size={28} /><strong>Жанры пока недоступны</strong><span>{error || 'Музыкальный каталог ещё не подключён.'}</span></div>

  return (
    <section className="genres-page">
      <header className="genres-hero">
        <div><span className="eyebrow"><Sparkles size={14} /> КАРТА ЗВУЧАНИЯ</span><h1>Найдите свой <em>жанр</em></h1><p>Листайте направления от пост-рока и эмбиента до металкора и русского рэпа. В каждом — полный редакционный топ и музыка разных эпох.</p></div>
        <div className="genres-hero__stats" aria-label="Статистика жанров"><span><strong>{data.genres.length}</strong><small>жанров</small></span><span><strong>{data.genres.reduce((sum, genre) => sum + genre.tracks.length, 0)}</strong><small>треков на старте</small></span></div>
      </header>

      <div className="genres-toolbar">
        <div className="genre-scope-tabs" role="tablist" aria-label="Раздел жанров">
          {scopes.filter((item) => genresByScope[item.id].length).map((item) => <button key={item.id} className={scope === item.id ? 'is-active' : ''} type="button" role="tab" aria-selected={scope === item.id} onClick={() => selectScope(item.id)}>{item.title}<small>{genresByScope[item.id].length}</small></button>)}
        </div>
        <label className="genres-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти жанр" aria-label="Найти жанр" /></label>
      </div>

      <div className="genre-card-grid">
        {visibleGenres.map((genre) => <GenreCard key={genre.id} genre={genre} active={genre.id === selectedGenre?.id} onClick={() => setGenreId(genre.id)} />)}
        {!visibleGenres.length && <div className="genres-empty genres-empty--search"><Search size={22} /><strong>Такого жанра здесь пока нет</strong><span>Попробуйте другое название.</span></div>}
      </div>

      {selectedGenre && <section className="genre-ranking">
        <header className="genre-ranking__header">
          <div><span className="eyebrow"><Flame size={14} /> ТОП ЖАНРА</span><h2>{selectedGenre.title}</h2><p>{selectedGenre.sourceTitle ? `По редакционной подборке «${selectedGenre.sourceTitle}»` : 'Порядок обновляется вместе с музыкальным каталогом.'}</p></div>
          <button className="primary-button" type="button" disabled={!section?.tracks.length} onClick={() => section && player.playQueue(section.tracks)}><Play size={17} fill="currentColor" /> Слушать выборку</button>
        </header>

        <div className="genre-periods" role="tablist" aria-label="Период релиза">
          {periods.map((item) => <button key={item.id} className={period === item.id ? 'is-active' : ''} type="button" role="tab" aria-selected={period === item.id} onClick={() => setPeriod(item.id)}><span>{item.id === 'all' ? <Headphones size={16} /> : <Clock3 size={16} />}{item.title}</span><small>{item.hint}</small></button>)}
        </div>

        <div className="genre-ranking__summary"><span>{selectedPeriod.hint}</span><strong>{section ? `${section.total} ${section.total === 1 ? 'трек' : 'треков'}` : 'Загрузка…'}</strong></div>
        {sectionLoading && !section ? <div className="global-top-state global-top-state--compact"><LoaderCircle className="spin" size={24} /><span>Загружаем топ жанра…</span></div> : sectionError && !section ? <div className="genres-empty"><Disc3 size={24} /><strong>{sectionError}</strong></div> : section && !section.tracks.length ? <div className="genres-empty"><Clock3 size={25} /><strong>В этом периоде пока нет треков</strong><span>В текущей редакционной подборке нет релизов выбранной эпохи.</span>{period !== 'all' && <button className="secondary-button" type="button" onClick={() => setPeriod('all')}>Показать всё время</button>}</div> : <div className="track-table track-table--large">{section?.tracks.map((track, index) => <TrackRow key={`${selectedGenre.id}-${period}-${track.id}`} track={track} context={section.tracks} index={index} />)}</div>}
        {sectionError && section && <div className="form-error genre-ranking__error">{sectionError}</div>}
        {section?.hasMore && <div className="global-top-load-more"><button className="secondary-button" type="button" disabled={sectionLoading} onClick={() => void loadMore()}>{sectionLoading ? <LoaderCircle className="spin" size={17} /> : null} Показать ещё</button><span>Показано {section.tracks.length} из {section.total}</span></div>}
      </section>}
    </section>
  )
}
