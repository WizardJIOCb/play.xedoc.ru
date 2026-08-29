import { ArrowLeft, CalendarDays, ChevronRight, Disc3, Globe2, LoaderCircle, Play, Radio, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getGlobalTopSection } from '../lib/api'
import { usePlayer } from '../player/PlayerContext'
import type { GlobalRelease, GlobalTopPayload, GlobalTopSection } from '../types'
import { CoverArt } from './CoverArt'
import { TrackRow } from './TrackRow'

function editionLabel(value: string) {
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date)
}

type GenreScope = 'international' | 'russian'

const genreScopeLabels: Record<GenreScope, string> = {
  international: 'Зарубежная',
  russian: 'Русская',
}

const TRACK_PAGE_SIZE = 20
const RELEASE_PAGE_SIZE = 8

type DetailRequest = {
  kind: GlobalTopSection['kind']
  id?: string
  title: string
  description?: string
}

function ReleaseGrid({ releases, onPlay }: { releases: GlobalRelease[]; onPlay: (release: GlobalRelease) => void }) {
  return <div className="global-release-grid">
    {releases.map((release) => (
      <button key={release.id} className="global-release-card" type="button" disabled={!release.tracks.length} onClick={() => onPlay(release)} aria-label={`Слушать релиз ${release.title}`}>
        <span className="global-release-card__art"><CoverArt title={release.title} url={release.coverUrl} className="global-release-card__cover" /><i><Play size={19} fill="currentColor" /></i></span>
        <strong>{release.title}</strong>
        <small>{release.artists.join(', ')}</small>
        <em>{release.genre || 'Новый релиз'}</em>
      </button>
    ))}
  </div>
}

export function GlobalTopPage({ data, loading, error }: { data?: GlobalTopPayload; loading: boolean; error?: string }) {
  const player = usePlayer()
  const [genreScope, setGenreScope] = useState<GenreScope>('international')
  const [genreId, setGenreId] = useState('')
  const [detail, setDetail] = useState<DetailRequest>()
  const [detailData, setDetailData] = useState<GlobalTopSection>()
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const genresByScope = useMemo(() => ({
    international: data?.genres.filter((genre) => genre.scope === 'international') || [],
    russian: data?.genres.filter((genre) => genre.scope === 'russian') || [],
  }), [data])
  const scopedGenres = genresByScope[genreScope]
  useEffect(() => {
    if (scopedGenres.length || !data?.genres.length) return
    const nextScope: GenreScope = genresByScope.international.length ? 'international' : 'russian'
    setGenreScope(nextScope)
    setGenreId(genresByScope[nextScope][0]?.id || '')
  }, [data, genresByScope, scopedGenres.length])
  useEffect(() => {
    if (!scopedGenres.some((genre) => genre.id === genreId)) setGenreId(scopedGenres[0]?.id || '')
  }, [genreId, scopedGenres])
  const selectedGenre = useMemo(
    () => scopedGenres.find((genre) => genre.id === genreId) || scopedGenres[0],
    [genreId, scopedGenres],
  )

  const selectGenreScope = (scope: GenreScope) => {
    setGenreScope(scope)
    setGenreId(genresByScope[scope][0]?.id || '')
  }

  useEffect(() => {
    if (!detail) return undefined
    let cancelled = false
    const pageSize = detail.kind === 'releases' ? RELEASE_PAGE_SIZE : TRACK_PAGE_SIZE
    setDetailData(undefined)
    setDetailError('')
    setDetailLoading(true)
    void getGlobalTopSection(detail.kind, detail.id, 0, pageSize)
      .then((result) => { if (!cancelled) setDetailData(result) })
      .catch(() => { if (!cancelled) setDetailError('Не удалось загрузить полный список. Попробуйте ещё раз.') })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [detail])

  const openDetail = (request: DetailRequest) => setDetail(request)

  const loadMore = async () => {
    if (!detail || !detailData || detailLoading || !detailData.hasMore) return
    const loaded = detail.kind === 'releases' ? detailData.releases.length : detailData.tracks.length
    const pageSize = detail.kind === 'releases' ? RELEASE_PAGE_SIZE : TRACK_PAGE_SIZE
    setDetailLoading(true)
    setDetailError('')
    try {
      const next = await getGlobalTopSection(detail.kind, detail.id, loaded, pageSize)
      setDetailData((current) => current ? {
        ...next,
        offset: 0,
        tracks: [...current.tracks, ...next.tracks],
        releases: [...current.releases, ...next.releases],
      } : next)
    } catch {
      setDetailError('Не удалось догрузить список. Попробуйте ещё раз.')
    } finally {
      setDetailLoading(false)
    }
  }

  if (loading) return <div className="global-top-state"><LoaderCircle className="spin" size={26} /><span>Собираем мировой чарт и свежие релизы…</span></div>
  if (error || !data) return <div className="global-top-state global-top-state--error"><Globe2 size={28} /><strong>Глобальный топ пока недоступен</strong><span>{error || 'Каталог ещё не подключён.'}</span></div>

  if (detail) {
    const tracks = detailData?.tracks || []
    const releases = detailData?.releases || []
    const loaded = detail.kind === 'releases' ? releases.length : tracks.length
    const total = detailData?.total || 0
    const pageSize = detail.kind === 'releases' ? RELEASE_PAGE_SIZE : TRACK_PAGE_SIZE
    const nextCount = Math.min(pageSize, Math.max(0, total - loaded))
    const playable = detail.kind === 'releases' ? releases.flatMap((release) => release.tracks) : tracks
    return <section className="global-top-page global-top-detail">
      <header className="global-top-detail__header">
        <button className="secondary-button global-top-detail__back" type="button" onClick={() => setDetail(undefined)}><ArrowLeft size={17} /> Все рубрики</button>
        <div><span className="eyebrow">ПОЛНЫЙ СПИСОК</span><h1>{detailData?.title || detail.title}</h1><p>{detailData?.description || detail.description || 'Рейтинг обновляется автоматически.'}</p></div>
        <div className="global-top-detail__actions"><span>{loaded} из {total || '…'}</span><button className="primary-button" type="button" disabled={!playable.length} onClick={() => player.playQueue(playable)}><Play size={17} fill="currentColor" /> Слушать загруженное</button></div>
      </header>
      {detailLoading && !detailData ? <div className="global-top-state global-top-state--compact"><LoaderCircle className="spin" size={24} /><span>Загружаем рубрику…</span></div> : detailError && !detailData ? <div className="global-top-state global-top-state--error global-top-state--compact"><Globe2 size={24} /><strong>{detailError}</strong></div> : detail.kind === 'releases' ? <ReleaseGrid releases={releases} onPlay={(release) => player.playQueue(release.tracks)} /> : <div className="track-table track-table--large">{tracks.map((track, index) => <TrackRow key={`${detail.kind}-${detail.id || 'all'}-${track.id}`} track={track} context={tracks} index={index} />)}</div>}
      {detailError && detailData && <div className="form-error global-top-detail__error">{detailError}</div>}
      {detailData?.hasMore && <div className="global-top-load-more"><button className="secondary-button" type="button" disabled={detailLoading} onClick={() => void loadMore()}>{detailLoading ? <LoaderCircle className="spin" size={17} /> : <ChevronRight size={17} />} Показать ещё {nextCount}</button><span>Уже показано {loaded} из {total}</span></div>}
    </section>
  }

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
        <header><div><span className="eyebrow">СЕГОДНЯ В МИРЕ</span><h2><button className="global-top-heading-button" type="button" onClick={() => openDetail({ kind: 'chart', title: data.chartTitle, description: data.chartDescription })}>{data.chartTitle}<ChevronRight size={22} /></button></h2><p>Откройте рубрику полностью или нажмите на строку, чтобы начать с неё.</p></div><span className="global-top-section__badge"><Radio size={15} /> LIVE CHART</span></header>
        <div className="track-table">
          {data.chart.slice(0, 30).map((track, index) => <TrackRow key={`global-${track.id}`} track={track} context={data.chart} index={index} />)}
        </div>
      </section>

      {Boolean(data.releases.length) && <section className="global-top-section">
        <header><div><span className="eyebrow">НОВОЕ ЗА ДЕНЬ</span><h2><button className="global-top-heading-button" type="button" onClick={() => openDetail({ kind: 'releases', title: 'Свежие релизы', description: 'Альбомы и синглы, которые только появились в каталоге.' })}>Свежие релизы<ChevronRight size={22} /></button></h2><p>Альбомы и синглы, которые только появились в каталоге.</p></div><Sparkles size={22} /></header>
        <ReleaseGrid releases={data.releases.slice(0, 10)} onPlay={(release) => player.playQueue(release.tracks)} />
      </section>}

      {selectedGenre && <section className="global-top-section global-top-genres">
        <header><div><span className="eyebrow">РЕЙТИНГИ ПО ЗВУЧАНИЮ</span><h2><button className="global-top-heading-button" type="button" title={`Открыть весь рейтинг «${selectedGenre.title}»`} onClick={() => openDetail({ kind: 'genre', id: selectedGenre.id, title: selectedGenre.title, description: selectedGenre.sourceTitle ? `По порядку в подборке «${selectedGenre.sourceTitle}»` : undefined })}>Жанровые рейтинги<ChevronRight size={22} /></button></h2><p>Отдельные топы зарубежной и русской музыки: от рока, метала и панка до попа, электроники, джаза и классики.</p></div><Disc3 size={22} /></header>
        <div className="global-genre-scopes" role="tablist" aria-label="Регион жанрового рейтинга">
          {(Object.keys(genreScopeLabels) as GenreScope[]).filter((scope) => genresByScope[scope].length).map((scope) => (
            <button key={scope} className={scope === genreScope ? 'is-active' : ''} type="button" role="tab" aria-selected={scope === genreScope} onClick={() => selectGenreScope(scope)}>{genreScopeLabels[scope]}<small>{genresByScope[scope].length} жанров</small></button>
          ))}
        </div>
        <div className="global-genre-tabs" role="tablist" aria-label={`Жанры: ${genreScopeLabels[genreScope].toLowerCase()} музыка`}>
          {scopedGenres.map((genre) => <button key={genre.id} className={genre.id === selectedGenre.id ? 'is-active' : ''} type="button" role="tab" aria-selected={genre.id === selectedGenre.id} aria-controls="global-genre-panel" onClick={() => setGenreId(genre.id)}>{genre.title}<small>{genre.tracks.length}</small></button>)}
        </div>
        <div className="global-genre-panel" id="global-genre-panel" role="tabpanel">
          <div><span className="eyebrow">{genreScope === 'international' ? 'ЗАРУБЕЖНЫЙ ТОП' : 'РУССКИЙ ТОП'}</span><h3><button className="global-top-heading-button" type="button" onClick={() => openDetail({ kind: 'genre', id: selectedGenre.id, title: selectedGenre.title, description: selectedGenre.sourceTitle ? `По порядку в подборке «${selectedGenre.sourceTitle}»` : undefined })}>{selectedGenre.title}<ChevronRight size={20} /></button></h3>{selectedGenre.sourceTitle && <p>По порядку в подборке «{selectedGenre.sourceTitle}»</p>}<button className="secondary-button" type="button" disabled={!selectedGenre.tracks.length} onClick={() => player.playQueue(selectedGenre.tracks)}><Play size={16} fill="currentColor" /> Слушать жанр</button></div>
          <div className="track-table">
            {selectedGenre.tracks.map((track, index) => <TrackRow key={`${selectedGenre.id}-${track.id}`} track={track} context={selectedGenre.tracks} index={index} compact />)}
          </div>
        </div>
      </section>}
    </section>
  )
}
