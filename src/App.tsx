import {
  ArrowLeft,
  ChevronRight,
  CalendarDays,
  Clock3,
  Flame,
  Headphones,
  Heart,
  History,
  KeyRound,
  ListMusic,
  LoaderCircle,
  LogIn,
  LogOut,
  Menu,
  Pause,
  Play,
  Pencil,
  Radio,
  Search,
  ShieldCheck,
  Shuffle,
  Sparkles,
  TrendingUp,
  Trophy,
  WandSparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthPromptProvider } from './auth/AuthPromptContext'
import { ConnectModal } from './components/ConnectModal'
import { AdminDashboardPage } from './components/AdminDashboardPage'
import { AlbumPage } from './components/AlbumPage'
import { AuthGate } from './components/AuthGate'
import { ArtistLinks } from './components/ArtistLinks'
import { CoverArt } from './components/CoverArt'
import { GlobalTooltip } from './components/GlobalTooltip'
import { FriendsPage } from './components/FriendsPage'
import { GlobalTopPage } from './components/GlobalTopPage'
import { GenresPage } from './components/GenresPage'
import { MoodMap, type MoodSettings } from './components/MoodMap'
import { PlayerBar } from './components/PlayerBar'
import { PasswordSetupModal } from './components/PasswordSetupModal'
import { PasswordChangeModal } from './components/PasswordChangeModal'
import { PlaylistCard } from './components/PlaylistCard'
import { PlaylistEditor } from './components/PlaylistEditor'
import { PLAYLISTS_CHANGED_EVENT } from './components/PlaylistPicker'
import { PublicSharePage } from './components/PublicSharePage'
import { PublicProfilePage } from './components/PublicProfilePage'
import { PublicSearchPage } from './components/PublicSearchPage'
import { SearchPalette } from './components/SearchPalette'
import { SessionBuilder } from './components/SessionBuilder'
import { ShareButton } from './components/ShareButton'
import { Sidebar } from './components/Sidebar'
import { SourcesModal } from './components/SourcesModal'
import { SocialFeedPage } from './components/SocialFeedPage'
import { TrackRow } from './components/TrackRow'
import { demoBootstrap } from './data/demo'
import { decodeVKImportFragment, getAllLikedTracks, getBootstrap, getDiscoveryRecommendations, getGlobalTop, getListeningStats, getPlaylist, logoutAccount, startVKImportJob } from './lib/api'
import { trackGoal, trackSection } from './lib/analytics'
import { isGlobalTopRoutePath } from './lib/globalTopRoutes'
import { APP_NAVIGATE_EVENT, installAppLinkNavigation } from './lib/navigation'
import { usePlayer } from './player/PlayerContext'
import type { BootstrapPayload, DiscoveryRecommendations, GlobalTopPayload, LikedTracksPayload, ListeningStats, Playlist, RecommendationCollection, Track, ViewId } from './types'

const viewTitles: Record<ViewId, { eyebrow: string; title: string; description: string }> = {
  home: { eyebrow: 'ВОСКРЕСЕНЬЕ · ВАШ РИТМ', title: 'Добрый день', description: 'Музыка, которая подходит именно сейчас.' },
  feed: { eyebrow: 'СОЦИАЛЬНЫЙ XEDOC', title: 'Лента', description: 'Записи друзей и людей с близким музыкальным вкусом.' },
  friends: { eyebrow: 'ЛЮДИ', title: 'Друзья', description: 'Знакомые и новые музыкальные связи.' },
  discover: { eyebrow: 'ОБЗОР', title: 'Найти новое', description: 'Знакомые ориентиры, неожиданные повороты.' },
  library: { eyebrow: 'КОЛЛЕКЦИЯ', title: 'Ваша библиотека', description: 'Всё важное — без лишних витрин.' },
  genres: { eyebrow: 'КАРТА ЗВУЧАНИЯ', title: 'Жанры', description: 'Музыка по направлениям и эпохам.' },
  liked: { eyebrow: 'МНЕ НРАВИТСЯ', title: 'Любимые треки', description: 'Музыка, к которой хочется возвращаться.' },
  history: { eyebrow: 'ИСТОРИЯ', title: 'Недавно слушали', description: 'Вернуться ровно туда, где остановились.' },
}

const isRecommendationsPath = () => window.location.pathname.replace(/\/+$/, '') === '/recommendations'
const isTopPath = () => window.location.pathname.replace(/\/+$/, '') === '/top'
const isGlobalTopPath = () => isGlobalTopRoutePath(window.location.pathname)
const isAdminPath = () => window.location.pathname.replace(/\/+$/, '') === '/admin'
const isSearchPath = () => window.location.pathname.replace(/\/+$/, '') === '/search'
const isAlbumPath = () => window.location.pathname.replace(/\/+$/, '') === '/album'
const pathView = (): ViewId => {
  const path = window.location.pathname.replace(/\/+$/, '')
  if (path === '/feed') return 'feed'
  if (path === '/friends') return 'friends'
  if (path === '/liked') return 'liked'
  if (path === '/genres') return 'genres'
  return 'home'
}

export function QuickTrack({ track, context }: { track: Track; context: Track[] }) {
  const player = usePlayer()
  const active = player.current?.id === track.id
  const playing = active && player.isPlaying
  const toggle = () => active ? player.togglePlayback() : player.playTrack(track, context)
  return (
    <div className={`quick-track ${playing ? 'is-active' : ''}`} role="button" tabIndex={0} aria-label={`${playing ? 'Пауза' : 'Включить'} ${track.title}`} onClick={toggle} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggle() } }}>
      <CoverArt title={track.title} url={track.coverUrl} tone={track.coverTone} className="quick-track__cover" />
      <span><strong>{track.title}</strong><ArtistLinks artists={track.artists} /></span>
      <span className="quick-track__play">{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</span>
    </div>
  )
}

function SectionHeader({ title, hint, action, onAction }: { title: string; hint?: string; action?: string; onAction?: () => void }) {
  return (
    <div className="section-header">
      <div><h2>{title}</h2>{hint && <p>{hint}</p>}</div>
      {action && onAction && <button type="button" onClick={onAction}>{action} <ChevronRight size={16} /></button>}
    </div>
  )
}

function HomeView({ data, authenticated, onSession, onRequireAuth, onPlaylist, onPlaylistPlay, onRecommendations }: { data: BootstrapPayload; authenticated: boolean; onSession: () => void; onRequireAuth: () => void; onPlaylist: (playlist: Playlist) => void; onPlaylistPlay: (playlist: Playlist) => void; onRecommendations: () => void }) {
  const player = usePlayer()
  return (
    <>
      <section className="hero-session">
        <div className="hero-session__copy">
          <span className="hero-session__label"><WandSparkles size={14} /> {authenticated ? 'XEDOC SESSION' : 'XEDOC PLAY · ГОСТЕВОЙ РЕЖИМ'}</span>
          <h2>{authenticated ? <>Сессия под ваши правила.<br /><em>Настройте — и слушайте.</em></> : <>Музыка играет сразу.<br /><em>Без регистрации.</em></>}</h2>
          <p>{authenticated ? (data.connected ? 'Выберите длительность, баланс знакомого и нового, источник музыки и период без повторов.' : 'Выберите длительность, источник музыки и период без повторов. Подборка строится по музыке, которую слушают в XEDOC.') : 'Слушайте популярное и ищите музыку в общем каталоге. Прослушивания не привязываются к профилю и не влияют на рекомендации.'}</p>
          <div className="hero-session__actions">
            {authenticated
              ? <><button className="primary-button" type="button" onClick={onSession}><Sparkles size={18} /> Настроить сессию</button><button className="secondary-button" type="button" disabled={!data.quickTracks.length} onClick={() => player.playQueue(data.quickTracks)}><Play size={17} fill="currentColor" /> Включить подборку</button></>
              : <><button className="primary-button" type="button" disabled={!data.quickTracks.length} onClick={() => player.playQueue(data.quickTracks)}><Play size={17} fill="currentColor" /> Включить популярное</button><button className="secondary-button" type="button" onClick={onRequireAuth}><LogIn size={17} /> Войти или зарегистрироваться</button></>}
          </div>
        </div>
        <div className="hero-session__visual">
          <div className="hero-session__settings">
            <span className="hero-session__settings-label">{authenticated ? 'Что можно настроить' : 'Что доступно без входа'}</span>
            <div className="hero-session__setting-list">
              <article><Clock3 size={19} /><span><strong>{authenticated ? '25 · 50 · 90 минут' : 'Популярное сейчас'}</strong><small>{authenticated ? 'Длительность сессии' : 'Общая подборка XEDOC'}</small></span></article>
              {authenticated && data.connected
                ? <article><Shuffle size={19} /><span><strong>0–100% открытий</strong><small>Баланс знакомого и нового</small></span></article>
                : <article><Radio size={19} /><span><strong>Каталог XEDOC</strong><small>Популярное и недавнее в сервисе</small></span></article>}
              <article><History size={19} /><span><strong>{authenticated ? '7 · 30 · 90 дней' : 'Без учёта профиля'}</strong><small>{authenticated ? 'Период без повторов' : 'Не привязываем к аккаунту'}</small></span></article>
            </div>
            <p><Headphones size={17} /><span>{data.quickTracks.length ? `${data.quickTracks.length} треков готовы к быстрому запуску` : 'Быстрая подборка пока формируется'}</span></p>
          </div>
        </div>
      </section>

      <section className="content-section">
        <SectionHeader title={data.connected ? 'Продолжить слушать' : 'Сейчас слушают в XEDOC'} hint={data.connected ? undefined : 'Живые прослушивания пользователей сервиса'} action="Показать всё" />
        <div className="quick-grid">
          {data.quickTracks.slice(0, 6).map((track) => <QuickTrack key={track.id} track={track} context={data.quickTracks} />)}
        </div>
      </section>

      <section className="content-section">
        <SectionHeader title={data.connected ? 'Сделано для вас' : 'Музыка в XEDOC'} hint={data.connected ? 'Рекомендации Яндекса, но в спокойном порядке' : 'Популярное, недавнее и главное за неделю'} action="Обновить" />
        <div className="playlist-grid">
          {data.recommendations.slice(0, 5).map((playlist) => <PlaylistCard key={playlist.id} playlist={playlist} onOpen={onPlaylist} onPlay={onPlaylistPlay} />)}
        </div>
      </section>

      {Boolean(data.xedocRecommendations.length) && <section className="content-section xedoc-recommendations">
        <SectionHeader title="XEDOC рекомендует" hint={data.recommendationInsight || 'Персональная выдача учится на ваших прослушиваниях'} action="Все рекомендации" onAction={onRecommendations} />
        <div className="track-table">
          {data.xedocRecommendations.slice(0, 8).map((track, index) => <TrackRow key={`xedoc-${track.id}`} track={track} context={data.xedocRecommendations} index={index} />)}
        </div>
      </section>}

      <section className="content-section rediscover-section">
        <SectionHeader title={data.connected || data.likedTracks.length ? 'Давно не слушали' : 'Ещё популярное'} hint={data.connected || data.likedTracks.length ? 'Любимые треки, которые затерялись в коллекции' : 'Продолжение общей подборки XEDOC'} action="Ещё 20" />
        <div className="track-table">
          {data.rediscover.map((track, index) => <TrackRow key={track.id} track={track} context={data.rediscover} index={index} />)}
        </div>
      </section>
    </>
  )
}

function RecommendationsView({ data }: { data: BootstrapPayload }) {
  const player = usePlayer()
  const [selectedId, setSelectedId] = useState(data.xedocCollections[0]?.id || '')
  const [discovery, setDiscovery] = useState<DiscoveryRecommendations>()
  const [discoveryLoading, setDiscoveryLoading] = useState(data.catalogAvailable)
  const [discoveryError, setDiscoveryError] = useState('')
  useEffect(() => {
    if (!data.xedocCollections.some((item) => item.id === selectedId)) setSelectedId(data.xedocCollections[0]?.id || '')
  }, [data.xedocCollections, selectedId])
  useEffect(() => {
    if (!data.catalogAvailable) {
      setDiscoveryLoading(false)
      return
    }
    let cancelled = false
    setDiscoveryLoading(true)
    setDiscoveryError('')
    void getDiscoveryRecommendations()
      .then((result) => { if (!cancelled) setDiscovery(result) })
      .catch(() => { if (!cancelled) setDiscoveryError('Не удалось подобрать новую музыку. Попробуйте открыть рекомендации чуть позже.') })
      .finally(() => { if (!cancelled) setDiscoveryLoading(false) })
    return () => { cancelled = true }
  }, [data.catalogAvailable])
  const selected = data.xedocCollections.find((item) => item.id === selectedId) || data.xedocCollections[0]

  return (
    <section className="recommendations-page">
      <header className="recommendations-page__hero">
        <div><span className="eyebrow"><TrendingUp size={15} /> ПЕРСОНАЛЬНАЯ ЛЕНТА XEDOC</span><h1>Ваши рекомендации.</h1><p>{data.recommendationInsight || 'Рекомендации станут точнее по мере прослушивания музыки.'}</p></div>
        <div className="recommendations-page__signal" data-tooltip="Количество подтверждённых прослушиваний в выбранном периоде"><strong>{selected?.signalCount || 0}</strong><span>прослушиваний<br />в выбранном периоде</span></div>
      </header>

      <div className="recommendation-periods" aria-label="Период подборки">
        {data.xedocCollections.map((collection: RecommendationCollection) => <button key={collection.id} className={collection.id === selected?.id ? 'is-active' : ''} type="button" onClick={() => setSelectedId(collection.id)}><CalendarDays size={18} /><span><strong>{collection.title}</strong><small>{collection.signalCount ? `${collection.signalCount} сигналов` : 'формируется'}</small></span></button>)}
      </div>

      {selected ? <section className="recommendation-period-detail">
        <header><div><span className="eyebrow">ОБНОВЛЯЕТСЯ АВТОМАТИЧЕСКИ</span><h2>{selected.title}</h2><p>{selected.subtitle}</p>{selected.fallback && <small>Пока в этом периоде мало прослушиваний — подборка заполнена треками, близкими вашему вкусу.</small>}</div><button className="primary-button" type="button" disabled={!selected.tracks.length} onClick={() => player.playQueue(selected.tracks)}><Play size={18} fill="currentColor" /> Слушать подборку</button></header>
        {selected.tracks.length ? <div className="track-table track-table--large">{selected.tracks.map((track, index) => <TrackRow key={`${selected.id}-${track.id}`} track={track} context={selected.tracks} index={index} />)}</div> : <div className="playlist-detail__loading">Послушайте несколько треков — здесь появится ваша подборка.</div>}
      </section> : <div className="playlist-detail__loading">Подборки появятся после подключения коллекции.</div>}

      <section className="discovery-recommendations">
        <header>
          <div className="discovery-recommendations__intro"><span className="discovery-recommendations__mark"><WandSparkles size={23} /></span><div><span className="eyebrow">НИ РАЗУ НЕ СЛУШАЛИ</span><h2>Новые для вас</h2><p>{discovery?.insight || 'Ищем музыку, похожую на то, что звучало у вас в последнее время.'}</p></div></div>
          {discovery && <div className="discovery-recommendations__proof" data-tooltip="Лайки, плейлисты и история XEDOC исключены из этой подборки"><strong>0</strong><span>знакомых<br />треков</span><small>{discovery.seedCount} ориентиров · {discovery.knownTrackCount} исключено</small></div>}
          <button className="primary-button" type="button" disabled={!discovery?.tracks.length} onClick={() => discovery && player.playQueue(discovery.tracks)}><Play size={18} fill="currentColor" /> Слушать новое</button>
        </header>
        {discoveryLoading ? <div className="playlist-detail__loading"><LoaderCircle className="spin" size={22} /> Ищем неизвестное рядом с любимым…</div> : discoveryError ? <div className="playlist-detail__loading form-error">{discoveryError}</div> : discovery?.tracks.length ? <div className="track-table track-table--large">{discovery.tracks.map((track, index) => <TrackRow key={`discovery-${track.id}`} track={track} context={discovery.tracks} index={index} />)}</div> : <div className="playlist-detail__loading">Послушайте несколько треков через XEDOC Play — новая подборка появится здесь.</div>}
      </section>

      <section className="content-section">
        <SectionHeader title="Для вас прямо сейчас" hint="Отдельная модель XEDOC: вкус, новизна и защита от недавних повторов" />
        <div className="track-table">{data.xedocRecommendations.map((track, index) => <TrackRow key={`adaptive-${track.id}`} track={track} context={data.xedocRecommendations} index={index} />)}</div>
      </section>
    </section>
  )
}

function formatListeningTime(durationMs: number) {
  const hours = Math.floor(durationMs / 3_600_000)
  const minutes = Math.round((durationMs % 3_600_000) / 60_000)
  return hours ? `${hours} ч ${minutes} мин` : `${minutes} мин`
}

function ListeningTopView({ stats, loading, error, authenticated }: { stats?: ListeningStats; loading: boolean; error?: string; authenticated: boolean }) {
  const player = usePlayer()
  const [selectedId, setSelectedId] = useState('day')
  const selected = stats?.top.find((item) => item.id === selectedId) || stats?.top[0]
  return (
    <section className="listening-top-page">
      <header className="listening-top-page__hero">
        <div><span className="eyebrow"><Trophy size={15} /> {authenticated ? 'ВАША МУЗЫКАЛЬНАЯ СТАТИСТИКА' : 'ПОПУЛЯРНО В XEDOC'}</span><h1>{authenticated ? <>Треки, которые<br /><em>остались с вами.</em></> : <>Треки, которые<br /><em>слушают сейчас.</em></>}</h1><p>{authenticated ? 'Рейтинг строится только по вашим прослушиваниям через XEDOC Play и обновляется автоматически.' : 'Общий рейтинг XEDOC Play доступен без регистрации и обновляется по подтверждённым прослушиваниям.'}</p></div>
        <div className="listening-top-page__numbers">
          <span data-tooltip="Количество запусков, которые играли не меньше 20 секунд"><strong>{stats?.totalPlays || 0}</strong><small>прослушиваний</small></span>
          <span data-tooltip="Количество разных треков в истории XEDOC"><strong>{stats?.uniqueTracks || 0}</strong><small>уникальных треков</small></span>
          <span data-tooltip="Суммарное время подтверждённых прослушиваний"><strong>{formatListeningTime(stats?.totalListenedMs || 0)}</strong><small>учтённое время</small></span>
        </div>
      </header>
      {loading ? <div className="playlist-detail__loading"><LoaderCircle className="spin" size={22} /> Собираем статистику…</div> : error ? <div className="playlist-detail__loading form-error">{error}</div> : stats && <>
        <div className="listening-top-tabs">{stats.top.map((period) => <button key={period.id} className={selected?.id === period.id ? 'is-active' : ''} type="button" onClick={() => setSelectedId(period.id)}><span>{period.title}</span><small>{period.totalPlays} прослушиваний</small></button>)}</div>
        <section className="listening-top-list">
          <header><div><span className="eyebrow">АВТОМАТИЧЕСКИЙ ТОП</span><h2>{selected?.title}</h2><p>{selected?.tracks.length || 0} уникальных треков · сортировка по количеству и времени прослушивания</p></div><button className="primary-button" type="button" disabled={!selected?.tracks.length} onClick={() => selected && player.playQueue(selected.tracks)}><Play size={18} fill="currentColor" /> Слушать топ</button></header>
          {selected?.tracks.length ? <div className="track-table track-table--large">{selected.tracks.map((track, index) => <TrackRow key={`${selected.id}-${track.id}`} track={track} context={selected.tracks} index={index} />)}</div> : <div className="playlist-detail__loading">В этом периоде пока нет подтверждённых прослушиваний.</div>}
        </section>
      </>}
    </section>
  )
}

function DiscoverView({ data, onSession, onPlaylist, onPlaylistPlay }: { data: BootstrapPayload; onSession: (settings: MoodSettings) => void; onPlaylist: (playlist: Playlist) => void; onPlaylistPlay: (playlist: Playlist) => void }) {
  return (
    <>
      <MoodMap onSession={onSession} />

      <section className="content-section">
        <SectionHeader title="Подборки под момент" hint="25, 50 или 90 минут — без обрыва на полуслове" />
        <div className="playlist-grid playlist-grid--wide">
          {data.recommendations.slice(0, 3).map((playlist) => <PlaylistCard key={playlist.id} playlist={playlist} wide onOpen={onPlaylist} onPlay={onPlaylistPlay} />)}
        </div>
      </section>

      <section className="content-section">
        <SectionHeader title="Рядом с любимым" action="Сменить направление" />
        <div className="playlist-grid">
          {[...data.recommendations].reverse().slice(0, 5).map((playlist) => <PlaylistCard key={playlist.id} playlist={playlist} onOpen={onPlaylist} onPlay={onPlaylistPlay} />)}
        </div>
      </section>
    </>
  )
}

function LibraryView({ data, onPlaylist, onPlaylistPlay, onSession, onCreate }: { data: BootstrapPayload; onPlaylist: (playlist: Playlist) => void; onPlaylistPlay: (playlist: Playlist) => void; onSession: () => void; onCreate: () => void }) {
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const ownPlaylists = data.localPlaylists.concat(data.playlists)
  const playlists = filter === 'mine' ? ownPlaylists : ownPlaylists.concat(data.recommendations.slice(0, 2))
  return (
    <>
      <div className="library-toolbar">
        <div className="filter-pills"><button className={filter === 'all' ? 'is-active' : ''} type="button" onClick={() => setFilter('all')}>Все</button><button className={filter === 'mine' ? 'is-active' : ''} type="button" onClick={() => setFilter('mine')}>Мои</button></div>
        <div className="layout-switch"><button className={layout === 'grid' ? 'is-active' : ''} type="button" onClick={() => setLayout('grid')} aria-label="Сетка"><Menu size={17} /></button><button className={layout === 'list' ? 'is-active' : ''} type="button" onClick={() => setLayout('list')} aria-label="Список"><ListMusic size={17} /></button></div>
      </div>
      <section className="content-section content-section--first">
        <SectionHeader title="Плейлисты" hint={data.connected ? `${data.localPlaylists.length} XEDOC · ${data.playlists.length} из Яндекс Музыки` : `${data.localPlaylists.length} личных плейлистов XEDOC`} action="Новый плейлист" onAction={onCreate} />
        <div className={`playlist-grid ${layout === 'list' ? 'playlist-grid--list' : ''}`}>
          {playlists.map((playlist) => <PlaylistCard key={playlist.id} playlist={playlist} wide={layout === 'list'} onOpen={onPlaylist} onPlay={onPlaylistPlay} />)}
        </div>
      </section>
      <section className="content-section library-lab">
        <div><span className="eyebrow">PLAYLIST LAB</span><h2>Смешать плейлисты без дублей</h2><p>Выберите несколько коллекций, ограничьте повторы артистов и сохраните чистый результат.</p></div>
        <button className="secondary-button" type="button" onClick={onSession}><Flame size={18} /> Открыть лабораторию</button>
      </section>
    </>
  )
}

function linkifyDescription(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, index) => part.match(/^https?:\/\//)
    ? <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer">{part}</a>
    : part)
}

function PlaylistDetailView({ playlist, loading, error, onBack, onEdit }: { playlist: Playlist; loading: boolean; error?: string; onBack: () => void; onEdit: (playlist: Playlist) => void }) {
  const player = usePlayer()
  const tracks = playlist.tracks || []
  const playbackSource = playlist.local ? { playlistId: playlist.id, playlistTitle: playlist.title } : undefined
  return (
    <section className="playlist-detail">
      <button className="playlist-detail__back" type="button" onClick={onBack}><ArrowLeft size={16} /> Назад к библиотеке</button>
      <header className="playlist-detail__hero">
        <CoverArt title={playlist.title} url={playlist.coverUrl} tone={playlist.coverTone} className="playlist-detail__cover" />
        <div className="playlist-detail__meta">
          <span className="eyebrow">ПЛЕЙЛИСТ</span>
          <h1>{playlist.title}</h1>
          <p className="playlist-description">{linkifyDescription(playlist.description || playlist.subtitle || 'Ваша коллекция в Яндекс Музыке')}</p>
          <span>{playlist.trackCount} треков{playlist.durationMinutes ? ` · ${Math.floor(playlist.durationMinutes / 60)} ч ${playlist.durationMinutes % 60} мин` : ''}</span>
          <div><button className="primary-button" type="button" disabled={!tracks.length} onClick={() => player.playQueue(tracks, 0, playbackSource)}><Play size={18} fill="currentColor" /> Слушать</button><button className="secondary-button" type="button" disabled={!tracks.length} onClick={() => player.playQueue([...tracks].sort(() => Math.random() - .5), 0, playbackSource)}><Shuffle size={17} /> Перемешать</button><ShareButton playlist={playlist} labeled />{playlist.local && <button className="secondary-button" type="button" onClick={() => onEdit(playlist)}><Pencil size={17} /> Редактировать</button>}</div>
        </div>
      </header>
      <div className="playlist-detail__summary" data-tooltip="Краткий анализ разнообразия плейлиста"><span><Sparkles size={15} /> XEDOC-анализ</span><p><strong>{new Set(tracks.flatMap((track) => track.artists)).size || '—'} артистов</strong><i />повторы разведены по очереди<i />можно собрать сессию без треков последних 30 дней</p></div>
      {loading ? <div className="playlist-detail__loading"><LoaderCircle className="spin" size={23} /> Загружаем треки…</div> : error ? <div className="playlist-detail__loading form-error">{error}</div> : tracks.length ? (
        <div className="track-table track-table--large">{tracks.map((track, index) => <TrackRow key={`${track.id}-${index}`} track={track} context={tracks} index={index} playbackSource={playbackSource} />)}</div>
      ) : <div className="playlist-detail__loading">В этом плейлисте пока нет треков.</div>}
    </section>
  )
}

export function filterCollectionTracks(type: 'liked' | 'history', tracks: Track[], isTrackLiked: (track: Track) => boolean) {
  return type === 'liked' ? tracks.filter(isTrackLiked) : tracks
}

export function stabilizeTrackOrder(order: string[], tracks: Track[]) {
  const byId = new Map(tracks.map((track) => [track.id, track]))
  const nextOrder = order.filter((id) => byId.has(id))
  const known = new Set(nextOrder)
  tracks.forEach((track) => {
    if (known.has(track.id)) return
    known.add(track.id)
    nextOrder.push(track.id)
  })
  return { order: nextOrder, tracks: nextOrder.flatMap((id) => byId.get(id) || []) }
}

function TrackCollectionView({ type, tracks, total, loading = false, error }: { type: 'liked' | 'history'; tracks: Track[]; total?: number; loading?: boolean; error?: string }) {
  const player = usePlayer()
  const historyOrderRef = useRef<string[]>([])
  const orderedTracks = type === 'history' ? stabilizeTrackOrder(historyOrderRef.current, tracks) : undefined
  if (orderedTracks) historyOrderRef.current = orderedTracks.order
  const visibleTracks = filterCollectionTracks(type, orderedTracks?.tracks || tracks, player.isTrackLiked)
  const visibleTotal = type === 'liked' ? visibleTracks.length : total ?? visibleTracks.length
  return (
    <section className="content-section content-section--first">
      <div className="collection-summary">
        <div className={`collection-summary__icon collection-summary__icon--${type}`}>{type === 'liked' ? <Heart size={34} fill="currentColor" /> : <History size={34} />}</div>
        <div><span className="eyebrow">{type === 'liked' ? 'ВАША КОЛЛЕКЦИЯ' : 'НА ЭТОМ УСТРОЙСТВЕ'}</span><h2>{type === 'liked' ? `${visibleTotal} любимых треков` : 'История прослушивания'}</h2><p>{type === 'liked' ? 'Показываем всю синхронизированную коллекцию без ограничений.' : 'История хранится локально и помогает убирать повторы.'}</p></div>
        <button className="primary-button" type="button" disabled={!visibleTracks.length} onClick={() => player.playQueue(visibleTracks)}><Play size={18} fill="currentColor" /> Слушать</button>
      </div>
      <div className="track-table track-table--large">
        {visibleTracks.map((track, index) => <TrackRow key={`${track.id}-${index}`} track={track} context={visibleTracks} index={index} />)}
      </div>
      {loading && <div className="playlist-detail__loading"><LoaderCircle className="spin" size={21} /> Загружаем все любимые треки…</div>}
      {error && <div className="playlist-detail__loading form-error">{error}</div>}
      {!loading && !error && !visibleTracks.length && <div className="playlist-detail__loading">{type === 'history' ? 'Здесь появятся треки после первого прослушивания.' : 'В текущей выдаче пока нет любимых треков.'}</div>}
    </section>
  )
}

function QueueContentView({ playlistTitle, loading = false, error = '' }: { playlistTitle?: string; loading?: boolean; error?: string }) {
  const player = usePlayer()
  const following = player.upNext
  const total = player.queue.length
  return (
    <section className="queue-page" aria-label="Очередь воспроизведения">
      <header className="queue-page__hero">
        <div><span className="eyebrow">{playlistTitle ? 'ВЫБРАННЫЙ ПЛЕЙЛИСТ' : 'СЕЙЧАС ИГРАЕТ'}</span><h1>{playlistTitle || 'Очередь.'}</h1><p>{total ? `${total} ${total === 1 ? 'трек' : total < 5 ? 'трека' : 'треков'} — всё, что прозвучит дальше.` : 'Соберите очередь из плейлиста, подборки или отдельных треков.'}</p></div>
        <div className="queue-page__count"><ListMusic size={23} /><strong>{total}</strong><span>{total === 1 ? 'трек' : total < 5 ? 'трека' : 'треков'}<br />в очереди</span></div>
      </header>
      {loading ? <div className="queue-page__empty"><LoaderCircle className="spin" size={28} /><p>Загружаем треки…</p><span>Собираем очередь выбранного плейлиста.</span></div> : error ? <div className="queue-page__empty queue-page__empty--error"><ListMusic size={28} /><p>Не удалось открыть плейлист</p><span>{error}</span></div> : total ? <>
        {player.current && <section className="queue-page__section"><header><div><span className="eyebrow">СЕЙЧАС ИГРАЕТ</span><h2>В эфире</h2><p>Этот трек уже звучит.</p></div></header><div className="track-table track-table--large"><TrackRow track={player.current} context={player.queue} index={player.currentIndex} /></div></section>}
        <section className="queue-page__section"><header><div><span className="eyebrow">ДАЛЬШЕ</span><h2>Следом в очереди</h2><p>{following.length ? `${following.length} ${following.length === 1 ? 'трек' : following.length < 5 ? 'трека' : 'треков'} ждут своей очереди.` : 'Это последний трек в очереди.'}</p></div></header>{following.length ? <div className="track-table track-table--large">{following.map((track, index) => <TrackRow key={`${track.id}-${index}`} track={track} context={player.queue} index={(player.currentIndex + index + 1) % player.queue.length} onQueueRemove={() => player.removeFromQueue(track)} />)}</div> : null}</section>
      </> : <div className="queue-page__empty"><ListMusic size={28} /><p>Очередь пока пуста</p><span>Включите плейлист или добавьте трек следующим.</span></div>}
    </section>
  )
}

function PrivateApp({ profileUsername }: { profileUsername?: string }) {
  const [data, setData] = useState<BootstrapPayload>(() => ({ ...demoBootstrap, accessLocked: true }))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState<ViewId>(pathView)
  const [recommendationsOpen, setRecommendationsOpen] = useState(isRecommendationsPath)
  const [topOpen, setTopOpen] = useState(isTopPath)
  const [globalTopOpen, setGlobalTopOpen] = useState(isGlobalTopPath)
  const [adminOpen, setAdminOpen] = useState(isAdminPath)
  const [listeningStats, setListeningStats] = useState<ListeningStats>()
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState('')
  const [globalTop, setGlobalTop] = useState<GlobalTopPayload>()
  const [globalTopLoading, setGlobalTopLoading] = useState(false)
  const [globalTopError, setGlobalTopError] = useState('')
  const [allLiked, setAllLiked] = useState<LikedTracksPayload>()
  const [likedLoading, setLikedLoading] = useState(false)
  const [likedError, setLikedError] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(isSearchPath)
  const [albumOpen, setAlbumOpen] = useState(isAlbumPath)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [sessionDiscovery, setSessionDiscovery] = useState(58)
  const [connectOpen, setConnectOpen] = useState(false)
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(() => new URLSearchParams(window.location.search).has('vkImport'))
  const [queueOpen, setQueueOpen] = useState(false)
  const [queuePlaylistTitle, setQueuePlaylistTitle] = useState('')
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueError, setQueueError] = useState('')
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist>()
  const [playlistLoading, setPlaylistLoading] = useState(false)
  const [playlistError, setPlaylistError] = useState('')
  const [playlistEditorOpen, setPlaylistEditorOpen] = useState(false)
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist>()
  const [authOpen, setAuthOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const vkImportStarted = useRef(false)
  const queueRequest = useRef(0)
  const player = usePlayer()
  const authenticated = data.authenticated && Boolean(data.appUser)
  const listeningStatsScope = useRef(authenticated)

  const requireAuth = useCallback(() => {
    if (authenticated) return true
    setAuthOpen(true)
    return false
  }, [authenticated])

  const navigatePath = useCallback((nextPath: string) => {
    if (window.location.pathname !== nextPath) window.history.pushState(null, '', nextPath)
    window.dispatchEvent(new Event(APP_NAVIGATE_EVENT))
  }, [])

  useEffect(() => {
    if (selectedPlaylist) {
      trackSection('playlist_detail', 'Плейлист')
      return
    }
    if (window.location.pathname === '/') trackSection(view, viewTitles[view].title)
  }, [selectedPlaylist, view])

  const refresh = useCallback(() => {
    setLoading(true)
    setLoadError('')
    void getBootstrap()
      .then(setData)
      .catch(() => setLoadError('Сервер плеера временно недоступен. Проверьте соединение и попробуйте ещё раз.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(refresh, [refresh])

  useEffect(() => {
    if (!data.appUser || vkImportStarted.current) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('vkImport') !== 'collect' || !window.location.hash) return
    vkImportStarted.current = true
    const fragment = window.location.hash
    window.history.replaceState(null, '', window.location.pathname)
    setSourcesOpen(true)
    void decodeVKImportFragment(fragment)
      .then(({ sourceUrl, tracks }) => {
        trackGoal('vk_import_started', { method: 'collector', trackCount: tracks.length })
        return startVKImportJob(sourceUrl, tracks)
      })
      .then((job) => setNotice(`Получено ${job.total} треков из VK. Импорт продолжается в фоне.`))
      .catch((reason) => setNotice(reason instanceof Error ? reason.message : 'Не удалось запустить импорт из VK'))
  }, [data.appUser])

  useEffect(() => {
    if (loading) return
    const userId = data.appUser?.id || 'guest'
    const ownerKey = 'xedoc-play-history-owner-v1'
    const previousOwner = window.localStorage.getItem(ownerKey)
    if (previousOwner && previousOwner !== userId) player.clear()
    window.localStorage.setItem(ownerKey, userId)
  }, [data.appUser?.id, loading, player])

  useEffect(() => {
    const onRouteChange = () => {
      setQueueOpen(false)
      setSelectedPlaylist(undefined)
      setRecommendationsOpen(isRecommendationsPath())
      setTopOpen(isTopPath())
      setGlobalTopOpen(isGlobalTopPath())
      setAdminOpen(isAdminPath())
      setSearchOpen(isSearchPath())
      setAlbumOpen(isAlbumPath())
      setPlaylistEditorOpen(false)
      setView(pathView())
    }
    window.addEventListener('popstate', onRouteChange)
    window.addEventListener(APP_NAVIGATE_EVENT, onRouteChange)
    return () => {
      window.removeEventListener('popstate', onRouteChange)
      window.removeEventListener(APP_NAVIGATE_EVENT, onRouteChange)
    }
  }, [])

  useEffect(() => {
    if (!topOpen || listeningStats || !data.catalogAvailable) return
    let cancelled = false
    setStatsLoading(true)
    setStatsError('')
    void getListeningStats()
      .then((result) => { if (!cancelled) setListeningStats(result) })
      .catch(() => { if (!cancelled) setStatsError('Не удалось загрузить статистику прослушиваний.') })
      .finally(() => { if (!cancelled) setStatsLoading(false) })
    return () => { cancelled = true }
  }, [authenticated, data.catalogAvailable, listeningStats, topOpen])

  useEffect(() => {
    if ((!globalTopOpen && view !== 'genres') || globalTop || !data.catalogAvailable) return
    let cancelled = false
    setGlobalTopLoading(true)
    setGlobalTopError('')
    void getGlobalTop()
      .then((result) => { if (!cancelled) setGlobalTop(result) })
      .catch(() => { if (!cancelled) setGlobalTopError('Не удалось загрузить мировой чарт. Попробуйте чуть позже.') })
      .finally(() => { if (!cancelled) setGlobalTopLoading(false) })
    return () => { cancelled = true }
  }, [data.catalogAvailable, globalTop, globalTopOpen, view])

  useEffect(() => {
    if (listeningStatsScope.current === authenticated) return
    listeningStatsScope.current = authenticated
    setListeningStats(undefined)
    setStatsError('')
  }, [authenticated])

  useEffect(() => {
    if (!authenticated || view !== 'liked' || allLiked || likedLoading || !data.catalogAvailable) return
    setLikedLoading(true)
    setLikedError('')
    void getAllLikedTracks().then(setAllLiked).catch(() => setLikedError('Не удалось загрузить все любимые треки.')).finally(() => setLikedLoading(false))
  }, [allLiked, authenticated, data.catalogAvailable, likedLoading, view])

  useEffect(() => {
    window.addEventListener(PLAYLISTS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(PLAYLISTS_CHANGED_EVENT, refresh)
  }, [refresh])

  const openPlaylist = useCallback((playlist: Playlist) => {
    setQueueOpen(false)
    setAlbumOpen(false)
    setSelectedPlaylist(playlist)
    setPlaylistError('')
    if (playlist.tracks?.length) return
    setPlaylistLoading(true)
    void getPlaylist(playlist.id)
      .then(setSelectedPlaylist)
      .catch(() => setPlaylistError('Не удалось загрузить этот плейлист. Попробуйте ещё раз позже.'))
      .finally(() => setPlaylistLoading(false))
  }, [])

  const playPlaylist = useCallback((playlist: Playlist) => {
    const playbackSource = playlist.local ? { playlistId: playlist.id, playlistTitle: playlist.title } : undefined
    if (playlist.tracks?.length) {
      player.playQueue(playlist.tracks, 0, playbackSource)
      return
    }
    void getPlaylist(playlist.id)
      .then((loaded) => {
        if (loaded.tracks?.length) player.playQueue(loaded.tracks, 0, loaded.local ? { playlistId: loaded.id, playlistTitle: loaded.title } : undefined)
        else setNotice('В этом плейлисте пока нет доступных треков')
      })
      .catch(() => setNotice('Не удалось запустить плейлист'))
  }, [player])

  const playPlaylistInQueue = useCallback((playlist: Playlist) => {
    const requestId = ++queueRequest.current
    setQueuePlaylistTitle(playlist.title)
    setQueueError('')
    setQueueOpen(true)
    const playLoaded = (loaded: Playlist) => {
      if (requestId !== queueRequest.current) return
      if (!loaded.tracks?.length) {
        setQueueError('В этом плейлисте пока нет доступных треков.')
        return
      }
      const playbackSource = loaded.local ? { playlistId: loaded.id, playlistTitle: loaded.title } : undefined
      player.playQueue(loaded.tracks, 0, playbackSource)
    }
    if (playlist.tracks?.length) {
      setQueueLoading(false)
      playLoaded(playlist)
      return
    }
    setQueueLoading(true)
    void getPlaylist(playlist.id)
      .then(playLoaded)
      .catch(() => {
        if (requestId === queueRequest.current) setQueueError('Не удалось загрузить треки. Попробуйте выбрать плейлист ещё раз.')
      })
      .finally(() => {
        if (requestId === queueRequest.current) setQueueLoading(false)
      })
  }, [player])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const changeView = useCallback((nextView: ViewId) => {
    if (nextView !== 'home' && nextView !== 'genres' && !requireAuth()) return
    setQueueOpen(false)
    setSelectedPlaylist(undefined)
    setRecommendationsOpen(false)
    setTopOpen(false)
    setGlobalTopOpen(false)
    setAdminOpen(false)
    setSearchOpen(false)
    const nextPath = nextView === 'liked' ? '/liked' : nextView === 'feed' ? '/feed' : nextView === 'friends' ? '/friends' : nextView === 'genres' ? '/genres' : '/'
    navigatePath(nextPath)
    setView(nextView)
  }, [navigatePath, requireAuth])

  const openRecommendations = useCallback(() => {
    if (!requireAuth()) return
    setQueueOpen(false)
    setSelectedPlaylist(undefined)
    setRecommendationsOpen(true)
    setTopOpen(false)
    setGlobalTopOpen(false)
    setAdminOpen(false)
    setSearchOpen(false)
    if (!isRecommendationsPath()) navigatePath('/recommendations')
  }, [navigatePath, requireAuth])

  const openTop = useCallback(() => {
    setQueueOpen(false)
    setSelectedPlaylist(undefined)
    setRecommendationsOpen(false)
    setTopOpen(true)
    setGlobalTopOpen(false)
    setAdminOpen(false)
    setSearchOpen(false)
    setListeningStats(undefined)
    if (!isTopPath()) navigatePath('/top')
  }, [navigatePath])

  const openGlobalTop = useCallback(() => {
    setQueueOpen(false)
    setSelectedPlaylist(undefined)
    setRecommendationsOpen(false)
    setTopOpen(false)
    setGlobalTopOpen(true)
    setAdminOpen(false)
    setSearchOpen(false)
    if (!isGlobalTopPath()) navigatePath('/global-top')
  }, [navigatePath])

  const openAdmin = useCallback(() => {
    if (!requireAuth()) return
    setQueueOpen(false)
    setSelectedPlaylist(undefined)
    setRecommendationsOpen(false)
    setTopOpen(false)
    setGlobalTopOpen(false)
    setAdminOpen(true)
    setSearchOpen(false)
    if (!isAdminPath()) navigatePath('/admin')
  }, [navigatePath, requireAuth])

  const openSearch = useCallback(() => {
    setQueueOpen(false)
    setSelectedPlaylist(undefined)
    setRecommendationsOpen(false)
    setTopOpen(false)
    setGlobalTopOpen(false)
    setAdminOpen(false)
    setSearchOpen(true)
    if (!isSearchPath()) navigatePath('/search')
    window.setTimeout(() => document.querySelector<HTMLInputElement>('.search-page__input input')?.focus(), 40)
  }, [navigatePath])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const interactive = Boolean(target.closest('input, textarea, select, button, a, [contenteditable="true"]'))
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openSearch()
      } else if (!interactive && event.key === '/') {
        event.preventDefault()
        openSearch()
      } else if (!interactive && event.code === 'Space') {
        event.preventDefault()
        player.togglePlayback()
      } else if (!interactive && event.key.toLowerCase() === 'q') setQueueOpen((value) => !value)
      else if (!interactive && event.key.toLowerCase() === 'n') player.next()
      else if (!interactive && event.key.toLowerCase() === 'p') player.previous()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSearch, player])

  const title = viewTitles[view]
  const openSession = useCallback((discovery = 58) => {
    if (!requireAuth()) return
    setSessionDiscovery(discovery)
    setSessionOpen(true)
  }, [requireAuth])

  const openNewPlaylist = useCallback(() => {
    if (!requireAuth()) return
    setEditingPlaylist(undefined)
    setPlaylistEditorOpen(true)
  }, [requireAuth])

  useEffect(() => {
    if (loading || authenticated || profileUsername || searchOpen || albumOpen) return
    if (topOpen || globalTopOpen) return
    if ((view === 'home' || view === 'genres') && !recommendationsOpen && !topOpen && !globalTopOpen && !adminOpen) return
    setView('home')
    setRecommendationsOpen(false)
    setTopOpen(false)
    setGlobalTopOpen(false)
    setAdminOpen(false)
    navigatePath('/')
    setAuthOpen(true)
  }, [adminOpen, albumOpen, authenticated, globalTopOpen, loading, navigatePath, profileUsername, recommendationsOpen, searchOpen, topOpen, view])
  const content = useMemo(() => {
    if (profileUsername) return <PublicProfilePage username={profileUsername} embedded viewer={data.appUser} onBack={() => changeView('home')} onProfileUpdated={(user) => setData((value) => ({ ...value, appUser: user }))} />
    if (queueOpen) return <QueueContentView playlistTitle={queuePlaylistTitle} loading={queueLoading} error={queueError} />
    if (albumOpen) return <AlbumPage />
    if (selectedPlaylist) return <PlaylistDetailView playlist={selectedPlaylist} loading={playlistLoading} error={playlistError} onBack={() => setSelectedPlaylist(undefined)} onEdit={(playlist) => { setEditingPlaylist(playlist); setPlaylistEditorOpen(true) }} />
    if (searchOpen) return <SearchPalette suggestions={data.quickTracks} onPlaylistPlay={playPlaylistInQueue} />
    if (adminOpen) return <AdminDashboardPage isAdmin={Boolean(data.appUser?.isAdmin)} />
    if (globalTopOpen) return <GlobalTopPage data={globalTop} loading={globalTopLoading} error={globalTopError} />
    if (topOpen) return <ListeningTopView stats={listeningStats} loading={statsLoading} error={statsError} authenticated={authenticated} />
    if (recommendationsOpen) return <RecommendationsView data={data} />
    if (view === 'genres') return <GenresPage data={globalTop} loading={globalTopLoading} error={globalTopError} />
    if (view === 'home') return <HomeView data={data} authenticated={authenticated} onSession={() => openSession()} onRequireAuth={() => setAuthOpen(true)} onPlaylist={openPlaylist} onPlaylistPlay={playPlaylist} onRecommendations={openRecommendations} />
    if (view === 'feed') return <SocialFeedPage user={data.appUser} tracks={data.quickTracks.concat(data.likedTracks)} playlists={data.localPlaylists.concat(data.playlists)} />
    if (view === 'friends') return <FriendsPage username={data.appUser?.username} />
    if (view === 'discover') return <DiscoverView data={data} onSession={(settings) => openSession(settings.novelty)} onPlaylist={openPlaylist} onPlaylistPlay={playPlaylist} />
    if (view === 'library') return <LibraryView data={data} onPlaylist={openPlaylist} onPlaylistPlay={playPlaylist} onSession={() => openSession()} onCreate={openNewPlaylist} />
    if (view === 'liked') return <TrackCollectionView type="liked" tracks={allLiked?.tracks || data.likedTracks} total={allLiked?.total ?? data.likedCount} loading={likedLoading} error={likedError} />
    return <TrackCollectionView type="history" tracks={player.history} />
  }, [adminOpen, albumOpen, allLiked, authenticated, changeView, data, globalTop, globalTopError, globalTopLoading, globalTopOpen, likedError, likedLoading, listeningStats, openNewPlaylist, openPlaylist, openRecommendations, openSession, playPlaylist, playPlaylistInQueue, player.history, playlistError, playlistLoading, profileUsername, queueError, queueLoading, queueOpen, queuePlaylistTitle, recommendationsOpen, searchOpen, selectedPlaylist, statsError, statsLoading, topOpen, view])

  if (loading && data.accessLocked) return <div className="app-loader"><LoaderCircle className="spin" size={28} /><span>Загружаем музыку…</span></div>
  if (loadError) return <main className="access-gate"><div className="access-gate__glow" /><form><span className="brand__mark">X</span><span className="eyebrow">XEDOC PLAY</span><h1>Не удалось подключиться.</h1><p>{loadError}</p><button className="primary-button" type="button" onClick={refresh}>Повторить</button></form></main>
  if (data.accessLocked) {
    if (profileUsername) return <PublicProfilePage username={profileUsername} />
    if (isSearchPath()) return <PublicSearchPage />
    return <AuthGate onAuthenticated={refresh} />
  }

  return (
    <AuthPromptProvider authenticated={authenticated} onRequireAuth={() => setAuthOpen(true)}>
    <div className={`app-shell ${sidebarCollapsed ? 'app-shell--compact' : ''}`}>
      <Sidebar view={searchOpen || albumOpen || profileUsername ? null : view} playlists={data.localPlaylists.concat(data.playlists)} collapsed={sidebarCollapsed} recommendationsActive={!profileUsername && recommendationsOpen} topActive={!profileUsername && topOpen} globalTopActive={!profileUsername && globalTopOpen} onView={changeView} onRecommendations={openRecommendations} onTop={openTop} onGlobalTop={openGlobalTop} onPlaylist={openPlaylist} onCreatePlaylist={openNewPlaylist} onToggle={() => setSidebarCollapsed((value) => !value)} onSession={() => openSession()} />
      <main className="main-view">
        <header className="topbar">
          <div className="topbar__history"><button className="icon-button" type="button" aria-label="Назад" disabled={!profileUsername && !selectedPlaylist && !recommendationsOpen && !topOpen && !globalTopOpen && !adminOpen && !searchOpen && !albumOpen} onClick={() => selectedPlaylist && !profileUsername ? setSelectedPlaylist(undefined) : changeView('home')}><ArrowLeft size={18} /></button></div>
          <div className="topbar__actions">
            <button className={`topbar__search ${searchOpen ? 'is-active' : ''}`} type="button" onClick={openSearch} aria-current={searchOpen ? 'page' : undefined} aria-label="Найти музыку" data-tooltip="Найти музыку (⌘ K)"><Search size={19} /></button>
            <button className={`queue-toggle ${queueOpen ? 'is-active' : ''}`} type="button" onClick={() => { setQueuePlaylistTitle(''); setQueueLoading(false); setQueueError(''); setQueueOpen((value) => !value) }} aria-pressed={queueOpen}><ListMusic size={18} /><span>Сейчас играет</span></button>
            {authenticated ? <><button className="connect-button" type="button" onClick={() => setSourcesOpen(true)} aria-label={data.connected ? 'Источники' : 'Подключить Яндекс Музыку'}><Headphones size={17} /><span>{data.connected ? 'Источники' : 'Подключить Яндекс'}</span></button>
            <div className="profile-chip"><a className="profile-chip__avatar" href={`/users/${encodeURIComponent(data.appUser?.username || '')}`} data-tooltip="Открыть публичный профиль" aria-label="Открыть публичный профиль">{data.appUser?.avatarUrl ? <img src={data.appUser.avatarUrl} alt="" /> : data.appUser?.displayName?.[0] || 'X'}</a><span><strong>{data.appUser?.displayName || 'Мой профиль'}</strong><small>@{data.appUser?.username}</small></span>{data.appUser?.isAdmin && <button className="icon-button" type="button" onClick={openAdmin} data-tooltip="Открыть админку" aria-label="Открыть админку"><ShieldCheck size={16} /></button>}<button className="icon-button" type="button" onClick={() => setPasswordChangeOpen(true)} data-tooltip="Изменить пароль" aria-label="Изменить пароль"><KeyRound size={16} /></button><button className="icon-button" type="button" onClick={() => { player.clear(); void logoutAccount().then(refresh) }} data-tooltip="Выйти из XEDOC" aria-label="Выйти из XEDOC"><LogOut size={16} /></button></div></> : <button className="guest-login-button" type="button" onClick={() => setAuthOpen(true)}><LogIn size={17} /><span>Войти</span></button>}
          </div>
        </header>

        <div className="page-content">
          {!profileUsername && !queueOpen && !selectedPlaylist && !recommendationsOpen && !topOpen && !globalTopOpen && !adminOpen && !searchOpen && !albumOpen && view !== 'genres' && <header className="page-heading">
            <div><span className="eyebrow">{title.eyebrow}</span><h1>{view === 'home' && data.appUser?.displayName ? `${title.title}, ${data.appUser.displayName.split(' ')[0]}` : title.title}</h1><p>{!authenticated && view === 'home' ? 'Популярная музыка XEDOC — можно слушать без регистрации.' : title.description}</p></div>
          </header>}
          {content}
        </div>
      </main>

      <PlayerBar onQueue={() => { setQueuePlaylistTitle(''); setQueueLoading(false); setQueueError(''); setQueueOpen((value) => !value) }} />
      {authenticated && <SessionBuilder open={sessionOpen} initialDiscovery={sessionDiscovery} onClose={() => setSessionOpen(false)} />}
      {authenticated && <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} onConnected={refresh} />}
      {authenticated && <SourcesModal open={sourcesOpen} yandexConnected={data.connected} onClose={() => { setSourcesOpen(false); if (new URLSearchParams(window.location.search).has('vkImport')) window.history.replaceState(null, '', window.location.pathname) }} onConnectYandex={() => setConnectOpen(true)} onChanged={refresh} />}
      {authenticated && <PasswordSetupModal open={Boolean(data.appUser?.needsPassword)} onSaved={refresh} />}
      {authenticated && <PasswordChangeModal open={passwordChangeOpen} onClose={() => setPasswordChangeOpen(false)} />}
      <PlaylistEditor
        open={playlistEditorOpen}
        playlist={editingPlaylist}
        onClose={() => setPlaylistEditorOpen(false)}
        onSaved={(playlist) => {
          if (selectedPlaylist?.id === playlist.id) void getPlaylist(playlist.id).then(setSelectedPlaylist)
          refresh()
        }}
        onDeleted={() => { setSelectedPlaylist(undefined); refresh() }}
      />

      <nav className="mobile-nav" aria-label="Мобильная навигация">
        {[['home', Headphones, 'Главная'], ['feed', Radio, 'Лента'], ['friends', Heart, 'Друзья'], ['library', ListMusic, 'Библиотека'], ['history', History, 'История']].map(([id, Icon, label]) => {
          const IconComponent = Icon as typeof Headphones
          return <button key={id as string} className={!recommendationsOpen && !topOpen && !globalTopOpen && !searchOpen && !albumOpen && view === id ? 'is-active' : ''} type="button" onClick={() => changeView(id as ViewId)}><IconComponent size={20} /><span>{label as string}</span></button>
        })}
      </nav>

      {notice && <div className="app-notice" role="status">{notice}</div>}
      {data.demo && <div className="demo-badge" data-tooltip="Сейчас показывается резервная демонстрационная коллекция"><span>{data.connected ? 'Яндекс временно недоступен · резервная выдача' : 'Демо-режим'}</span>{!data.connected && <button type="button" onClick={() => setConnectOpen(true)}>Подключить коллекцию <ChevronRight size={14} /></button>}</div>}
      {authOpen && <AuthGate modal onClose={() => setAuthOpen(false)} onAuthenticated={() => { setAuthOpen(false); refresh() }} />}
    </div>
    </AuthPromptProvider>
  )
}

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname)

  useEffect(() => {
    const updatePathname = () => setPathname(window.location.pathname)
    const removeLinkNavigation = installAppLinkNavigation()
    window.addEventListener('popstate', updatePathname)
    window.addEventListener(APP_NAVIGATE_EVENT, updatePathname)
    return () => {
      removeLinkNavigation()
      window.removeEventListener('popstate', updatePathname)
      window.removeEventListener(APP_NAVIGATE_EVENT, updatePathname)
    }
  }, [])

  const shareMatch = pathname.match(/^\/share\/([A-Za-z0-9_-]{20,80})\/?$/)
  const profileMatch = pathname.match(/^\/users\/([A-Za-z0-9_.-]{3,32})\/?$/)
  return <>{shareMatch ? <PublicSharePage token={shareMatch[1]} /> : <PrivateApp profileUsername={profileMatch?.[1]} />}<GlobalTooltip /></>
}
