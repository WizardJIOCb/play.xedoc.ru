import {
  ArrowLeft,
  ChevronRight,
  CalendarDays,
  Clock3,
  Command,
  Flame,
  Headphones,
  Heart,
  History,
  KeyRound,
  ListMusic,
  LoaderCircle,
  LogOut,
  Menu,
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
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConnectModal } from './components/ConnectModal'
import { AdminDashboardPage } from './components/AdminDashboardPage'
import { AuthGate } from './components/AuthGate'
import { CoverArt } from './components/CoverArt'
import { GlobalTooltip } from './components/GlobalTooltip'
import { PlayerBar } from './components/PlayerBar'
import { PasswordSetupModal } from './components/PasswordSetupModal'
import { PasswordChangeModal } from './components/PasswordChangeModal'
import { PlaylistCard } from './components/PlaylistCard'
import { PlaylistEditor } from './components/PlaylistEditor'
import { PLAYLISTS_CHANGED_EVENT } from './components/PlaylistPicker'
import { PublicSharePage } from './components/PublicSharePage'
import { PublicProfilePage } from './components/PublicProfilePage'
import { SearchPalette } from './components/SearchPalette'
import { SessionBuilder } from './components/SessionBuilder'
import { ShareButton } from './components/ShareButton'
import { Sidebar } from './components/Sidebar'
import { SourcesModal } from './components/SourcesModal'
import { TrackRow } from './components/TrackRow'
import { demoBootstrap } from './data/demo'
import { decodeVKImportFragment, getAllLikedTracks, getBootstrap, getDiscoveryRecommendations, getListeningStats, getPlaylist, logoutAccount, startVKImportJob } from './lib/api'
import { trackGoal, trackSection } from './lib/analytics'
import { usePlayer } from './player/PlayerContext'
import type { BootstrapPayload, DiscoveryRecommendations, LikedTracksPayload, ListeningStats, Playlist, RecommendationCollection, Track, ViewId } from './types'

const viewTitles: Record<ViewId, { eyebrow: string; title: string; description: string }> = {
  home: { eyebrow: 'ВОСКРЕСЕНЬЕ · ВАШ РИТМ', title: 'Добрый день', description: 'Музыка, которая подходит именно сейчас.' },
  discover: { eyebrow: 'ОБЗОР', title: 'Найти новое', description: 'Знакомые ориентиры, неожиданные повороты.' },
  library: { eyebrow: 'КОЛЛЕКЦИЯ', title: 'Ваша библиотека', description: 'Всё важное — без лишних витрин.' },
  liked: { eyebrow: 'МНЕ НРАВИТСЯ', title: 'Любимые треки', description: 'Музыка, к которой хочется возвращаться.' },
  history: { eyebrow: 'ИСТОРИЯ', title: 'Недавно слушали', description: 'Вернуться ровно туда, где остановились.' },
}

const isRecommendationsPath = () => window.location.pathname.replace(/\/+$/, '') === '/recommendations'
const isTopPath = () => window.location.pathname.replace(/\/+$/, '') === '/top'
const isLikedPath = () => window.location.pathname.replace(/\/+$/, '') === '/liked'
const isAdminPath = () => window.location.pathname.replace(/\/+$/, '') === '/admin'

function QuickTrack({ track, context }: { track: Track; context: Track[] }) {
  const player = usePlayer()
  const active = player.current?.id === track.id
  return (
    <button className={`quick-track ${active ? 'is-active' : ''}`} type="button" onClick={() => active ? player.togglePlayback() : player.playTrack(track, context)}>
      <CoverArt title={track.title} url={track.coverUrl} tone={track.coverTone} className="quick-track__cover" />
      <span><strong>{track.title}</strong><small>{track.artists.join(', ')}</small></span>
      <span className="quick-track__play"><Play size={16} fill="currentColor" /></span>
    </button>
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

function HomeView({ data, onSession, onPlaylist, onPlaylistPlay, onRecommendations }: { data: BootstrapPayload; onSession: () => void; onPlaylist: (playlist: Playlist) => void; onPlaylistPlay: (playlist: Playlist) => void; onRecommendations: () => void }) {
  const player = usePlayer()
  return (
    <>
      <section className="hero-session">
        <div className="hero-session__copy">
          <span className="hero-session__label"><WandSparkles size={14} /> XEDOC SESSION</span>
          <h2>50 минут музыки.<br /><em>Ни одного случайного повтора.</em></h2>
          <p>Смешаем любимое с новым, сохраним ритм и не поставим одного артиста дважды рядом.</p>
          <div className="hero-session__actions">
            <button className="primary-button" type="button" onClick={onSession}><Sparkles size={18} /> Собрать сессию</button>
            <button className="secondary-button" type="button" onClick={() => player.playQueue(data.quickTracks)}><Play size={17} fill="currentColor" /> Быстрый старт</button>
          </div>
        </div>
        <div className="hero-session__visual" aria-hidden="true">
          <span className="orbit orbit--one"><i /></span>
          <span className="orbit orbit--two"><i /></span>
          <span className="orbit orbit--three"><i /></span>
          <div className="hero-session__core"><strong>58%</strong><small>нового</small></div>
          <div className="hero-session__note note--top"><Zap size={15} /> мягкая энергия</div>
          <div className="hero-session__note note--bottom"><Clock3 size={15} /> cooldown 30 дней</div>
        </div>
      </section>

      <section className="content-section">
        <SectionHeader title="Продолжить слушать" action="Показать всё" />
        <div className="quick-grid">
          {data.quickTracks.slice(0, 6).map((track) => <QuickTrack key={track.id} track={track} context={data.quickTracks} />)}
        </div>
      </section>

      <section className="content-section">
        <SectionHeader title="Сделано для вас" hint="Рекомендации Яндекса, но в спокойном порядке" action="Обновить" />
        <div className="playlist-grid">
          {data.recommendations.slice(0, 5).map((playlist) => <PlaylistCard key={playlist.id} playlist={playlist} onOpen={onPlaylist} onPlay={onPlaylistPlay} />)}
        </div>
      </section>

      <section className="content-section xedoc-recommendations">
        <SectionHeader title="XEDOC рекомендует" hint={data.recommendationInsight || 'Персональная выдача учится на ваших прослушиваниях'} action="Все рекомендации" onAction={onRecommendations} />
        <div className="track-table">
          {data.xedocRecommendations.slice(0, 8).map((track, index) => <TrackRow key={`xedoc-${track.id}`} track={track} context={data.xedocRecommendations} index={index} />)}
        </div>
      </section>

      <section className="content-section rediscover-section">
        <SectionHeader title="Давно не слушали" hint="Любимые треки, которые затерялись в коллекции" action="Ещё 20" />
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
  const [discoveryLoading, setDiscoveryLoading] = useState(data.connected)
  const [discoveryError, setDiscoveryError] = useState('')
  useEffect(() => {
    if (!data.xedocCollections.some((item) => item.id === selectedId)) setSelectedId(data.xedocCollections[0]?.id || '')
  }, [data.xedocCollections, selectedId])
  useEffect(() => {
    if (!data.connected) {
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
  }, [data.connected])
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

function ListeningTopView({ stats, loading, error }: { stats?: ListeningStats; loading: boolean; error?: string }) {
  const player = usePlayer()
  const [selectedId, setSelectedId] = useState('day')
  const selected = stats?.top.find((item) => item.id === selectedId) || stats?.top[0]
  return (
    <section className="listening-top-page">
      <header className="listening-top-page__hero">
        <div><span className="eyebrow"><Trophy size={15} /> ВАША МУЗЫКАЛЬНАЯ СТАТИСТИКА</span><h1>Треки, которые<br /><em>остались с вами.</em></h1><p>Рейтинг строится только по прослушиваниям через XEDOC Play и обновляется автоматически.</p></div>
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

function DiscoverView({ data, onSession, onPlaylist, onPlaylistPlay }: { data: BootstrapPayload; onSession: () => void; onPlaylist: (playlist: Playlist) => void; onPlaylistPlay: (playlist: Playlist) => void }) {
  const [mood, setMood] = useState('deep')
  return (
    <>
      <section className="mood-map">
        <div className="mood-map__intro">
          <span className="eyebrow">КАРТА НАСТРОЕНИЯ</span>
          <h2>Куда повернём сегодня?</h2>
          <p>Это не жанры. Это направление для рекомендаций.</p>
          <div className="mood-map__choices">
            {[['deep', 'Глубже'], ['fresh', 'Совсем новое'], ['bright', 'Больше энергии'], ['calm', 'Спокойнее']].map(([id, label]) => (
              <button key={id} className={mood === id ? 'is-active' : ''} type="button" onClick={() => setMood(id)}>{label}</button>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={onSession}><Radio size={18} /> Настроить волну</button>
        </div>
        <div className={`mood-map__canvas mood-map__canvas--${mood}`}>
          <span className="mood-axis mood-axis--x">знакомое <i /> новое</span>
          <span className="mood-axis mood-axis--y">спокойно <i /> энергия</span>
          <div className="mood-map__field"><i /><i /><i /><i /><i /><i /><i /><i /><span><Sparkles size={19} /></span></div>
        </div>
      </section>

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
        <SectionHeader title="Плейлисты" hint={`${data.localPlaylists.length} XEDOC · ${data.playlists.length} из Яндекс Музыки`} action="Новый плейлист" onAction={onCreate} />
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

function TrackCollectionView({ type, tracks, total, loading = false, error }: { type: 'liked' | 'history'; tracks: Track[]; total?: number; loading?: boolean; error?: string }) {
  const player = usePlayer()
  return (
    <section className="content-section content-section--first">
      <div className="collection-summary">
        <div className={`collection-summary__icon collection-summary__icon--${type}`}>{type === 'liked' ? <Heart size={34} fill="currentColor" /> : <History size={34} />}</div>
        <div><span className="eyebrow">{type === 'liked' ? 'ВАША КОЛЛЕКЦИЯ' : 'НА ЭТОМ УСТРОЙСТВЕ'}</span><h2>{type === 'liked' ? `${total ?? tracks.length} любимых треков` : 'История прослушивания'}</h2><p>{type === 'liked' ? 'Показываем всю синхронизированную коллекцию без ограничений.' : 'История хранится локально и помогает убирать повторы.'}</p></div>
        <button className="primary-button" type="button" disabled={!tracks.length} onClick={() => player.playQueue(tracks)}><Play size={18} fill="currentColor" /> Слушать</button>
      </div>
      <div className="track-table track-table--large">
        {tracks.map((track, index) => <TrackRow key={`${track.id}-${index}`} track={track} context={tracks} index={index} />)}
      </div>
      {loading && <div className="playlist-detail__loading"><LoaderCircle className="spin" size={21} /> Загружаем все любимые треки…</div>}
      {error && <div className="playlist-detail__loading form-error">{error}</div>}
      {!loading && !error && !tracks.length && <div className="playlist-detail__loading">{type === 'history' ? 'Здесь появятся треки после первого прослушивания.' : 'В текущей выдаче пока нет любимых треков.'}</div>}
    </section>
  )
}

function QueuePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const player = usePlayer()
  if (!open) return null
  return (
    <aside className="queue-panel">
      <header><div><span className="eyebrow">ДАЛЬШЕ</span><h2>Очередь</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть очередь"><X size={20} /></button></header>
      {player.current && <div className="queue-panel__current"><small>Сейчас играет</small><TrackRow track={player.current} context={player.queue} compact /></div>}
      <div className="queue-panel__list"><small>Следом</small>{player.upNext.map((track, index) => <TrackRow key={`${track.id}-${index}`} track={track} context={player.queue} compact />)}</div>
      {!player.queue.length && <div className="queue-panel__empty"><ListMusic size={28} /><p>Очередь пока пуста</p><span>Включите плейлист или добавьте трек следующим.</span></div>}
    </aside>
  )
}

function PrivateApp() {
  const [data, setData] = useState<BootstrapPayload>(() => ({ ...demoBootstrap, accessLocked: true }))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState<ViewId>(() => isLikedPath() ? 'liked' : 'home')
  const [recommendationsOpen, setRecommendationsOpen] = useState(isRecommendationsPath)
  const [topOpen, setTopOpen] = useState(isTopPath)
  const [adminOpen, setAdminOpen] = useState(isAdminPath)
  const [listeningStats, setListeningStats] = useState<ListeningStats>()
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState('')
  const [allLiked, setAllLiked] = useState<LikedTracksPayload>()
  const [likedLoading, setLikedLoading] = useState(false)
  const [likedError, setLikedError] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(() => new URLSearchParams(window.location.search).has('vkImport'))
  const [queueOpen, setQueueOpen] = useState(false)
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist>()
  const [playlistLoading, setPlaylistLoading] = useState(false)
  const [playlistError, setPlaylistError] = useState('')
  const [playlistEditorOpen, setPlaylistEditorOpen] = useState(false)
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist>()
  const [notice, setNotice] = useState('')
  const vkImportStarted = useRef(false)
  const player = usePlayer()

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
    const userId = data.appUser?.id
    if (!userId) return
    const ownerKey = 'xedoc-play-history-owner-v1'
    const previousOwner = window.localStorage.getItem(ownerKey)
    if (previousOwner && previousOwner !== userId) player.clear()
    window.localStorage.setItem(ownerKey, userId)
  }, [data.appUser?.id, player])

  useEffect(() => {
    const onPopState = () => {
      setSelectedPlaylist(undefined)
      setRecommendationsOpen(isRecommendationsPath())
      setTopOpen(isTopPath())
      setAdminOpen(isAdminPath())
      setView(isLikedPath() ? 'liked' : 'home')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!topOpen || listeningStats || statsLoading || !data.connected) return
    setStatsLoading(true)
    setStatsError('')
    void getListeningStats().then(setListeningStats).catch(() => setStatsError('Не удалось загрузить статистику прослушиваний.')).finally(() => setStatsLoading(false))
  }, [data.connected, listeningStats, statsLoading, topOpen])

  useEffect(() => {
    if (view !== 'liked' || allLiked || likedLoading || !data.connected) return
    setLikedLoading(true)
    setLikedError('')
    void getAllLikedTracks().then(setAllLiked).catch(() => setLikedError('Не удалось загрузить все любимые треки.')).finally(() => setLikedLoading(false))
  }, [allLiked, data.connected, likedLoading, view])

  useEffect(() => {
    window.addEventListener(PLAYLISTS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(PLAYLISTS_CHANGED_EVENT, refresh)
  }, [refresh])

  const openPlaylist = useCallback((playlist: Playlist) => {
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

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const changeView = useCallback((nextView: ViewId) => {
    setSelectedPlaylist(undefined)
    setRecommendationsOpen(false)
    setTopOpen(false)
    setAdminOpen(false)
    const nextPath = nextView === 'liked' ? '/liked' : '/'
    if (window.location.pathname !== nextPath) window.history.pushState(null, '', nextPath)
    setView(nextView)
  }, [])

  const openRecommendations = useCallback(() => {
    setSelectedPlaylist(undefined)
    setRecommendationsOpen(true)
    setTopOpen(false)
    setAdminOpen(false)
    if (!isRecommendationsPath()) window.history.pushState(null, '', '/recommendations')
  }, [])

  const openTop = useCallback(() => {
    setSelectedPlaylist(undefined)
    setRecommendationsOpen(false)
    setTopOpen(true)
    setAdminOpen(false)
    setListeningStats(undefined)
    if (!isTopPath()) window.history.pushState(null, '', '/top')
  }, [])

  const openAdmin = useCallback(() => {
    setSelectedPlaylist(undefined)
    setRecommendationsOpen(false)
    setTopOpen(false)
    setAdminOpen(true)
    if (!isAdminPath()) window.history.pushState(null, '', '/admin')
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const interactive = Boolean(target.closest('input, textarea, select, button, a, [contenteditable="true"]'))
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      } else if (!interactive && event.key === '/') {
        event.preventDefault()
        setSearchOpen(true)
      } else if (!interactive && event.code === 'Space') {
        event.preventDefault()
        player.togglePlayback()
      } else if (!interactive && event.key.toLowerCase() === 'q') setQueueOpen((value) => !value)
      else if (!interactive && event.key.toLowerCase() === 'n') player.next()
      else if (!interactive && event.key.toLowerCase() === 'p') player.previous()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player])

  const title = viewTitles[view]
  const content = useMemo(() => {
    if (selectedPlaylist) return <PlaylistDetailView playlist={selectedPlaylist} loading={playlistLoading} error={playlistError} onBack={() => setSelectedPlaylist(undefined)} onEdit={(playlist) => { setEditingPlaylist(playlist); setPlaylistEditorOpen(true) }} />
    if (adminOpen) return <AdminDashboardPage isAdmin={Boolean(data.appUser?.isAdmin)} />
    if (topOpen) return <ListeningTopView stats={listeningStats} loading={statsLoading} error={statsError} />
    if (recommendationsOpen) return <RecommendationsView data={data} />
    if (view === 'home') return <HomeView data={data} onSession={() => setSessionOpen(true)} onPlaylist={openPlaylist} onPlaylistPlay={playPlaylist} onRecommendations={openRecommendations} />
    if (view === 'discover') return <DiscoverView data={data} onSession={() => setSessionOpen(true)} onPlaylist={openPlaylist} onPlaylistPlay={playPlaylist} />
    if (view === 'library') return <LibraryView data={data} onPlaylist={openPlaylist} onPlaylistPlay={playPlaylist} onSession={() => setSessionOpen(true)} onCreate={() => { setEditingPlaylist(undefined); setPlaylistEditorOpen(true) }} />
    if (view === 'liked') return <TrackCollectionView type="liked" tracks={allLiked?.tracks || data.likedTracks} total={allLiked?.total ?? data.likedCount} loading={likedLoading} error={likedError} />
    return <TrackCollectionView type="history" tracks={player.history} />
  }, [adminOpen, allLiked, data, likedError, likedLoading, listeningStats, openPlaylist, openRecommendations, playPlaylist, player.history, playlistError, playlistLoading, recommendationsOpen, selectedPlaylist, statsError, statsLoading, topOpen, view])

  if (loading && data.accessLocked) return <div className="app-loader"><LoaderCircle className="spin" size={28} /><span>Загружаем музыку…</span></div>
  if (loadError) return <main className="access-gate"><div className="access-gate__glow" /><form><span className="brand__mark">X</span><span className="eyebrow">XEDOC PLAY</span><h1>Не удалось подключиться.</h1><p>{loadError}</p><button className="primary-button" type="button" onClick={refresh}>Повторить</button></form></main>
  if (data.accessLocked) return <AuthGate onAuthenticated={refresh} />

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'app-shell--compact' : ''} ${queueOpen ? 'app-shell--queue' : ''}`}>
      <Sidebar view={view} playlists={data.localPlaylists.concat(data.playlists)} collapsed={sidebarCollapsed} recommendationsActive={recommendationsOpen} topActive={topOpen} onView={changeView} onRecommendations={openRecommendations} onTop={openTop} onToggle={() => setSidebarCollapsed((value) => !value)} onSession={() => setSessionOpen(true)} />
      <main className="main-view">
        <header className="topbar">
          <div className="topbar__history"><button className="icon-button" type="button" aria-label="Назад" disabled={!selectedPlaylist && !recommendationsOpen && !topOpen && !adminOpen} onClick={() => selectedPlaylist ? setSelectedPlaylist(undefined) : changeView('home')}><ArrowLeft size={18} /></button></div>
          <button className="topbar__search" type="button" onClick={() => setSearchOpen(true)}><Search size={18} /><span>Найти музыку</span><kbd><Command size={13} /> K</kbd></button>
          <div className="topbar__actions">
            <button className="connect-button" type="button" onClick={() => setSourcesOpen(true)} data-tooltip="Подключить Яндекс Музыку или импортировать вкус из VK"><Headphones size={17} /><span>{data.connected ? 'Источники' : 'Подключить музыку'}</span></button>
            <div className="profile-chip" data-tooltip={`Аккаунт XEDOC: @${data.appUser?.username || ''}`}><a className="profile-chip__avatar" href={`/users/${encodeURIComponent(data.appUser?.username || '')}`} data-tooltip="Открыть публичный профиль" aria-label="Открыть публичный профиль">{data.appUser?.displayName?.[0] || 'X'}</a><span><strong>{data.appUser?.displayName || 'Мой профиль'}</strong><small>@{data.appUser?.username}</small></span>{data.appUser?.isAdmin && <button className="icon-button" type="button" onClick={openAdmin} data-tooltip="Открыть админку" aria-label="Открыть админку"><ShieldCheck size={16} /></button>}<button className="icon-button" type="button" onClick={() => setPasswordChangeOpen(true)} data-tooltip="Изменить пароль" aria-label="Изменить пароль"><KeyRound size={16} /></button><button className="icon-button" type="button" onClick={() => { player.clear(); void logoutAccount().then(refresh) }} data-tooltip="Выйти из XEDOC" aria-label="Выйти из XEDOC"><LogOut size={16} /></button></div>
          </div>
        </header>

        <div className="page-content">
          {!selectedPlaylist && !recommendationsOpen && !topOpen && !adminOpen && <header className="page-heading">
            <div><span className="eyebrow">{title.eyebrow}</span><h1>{view === 'home' && data.appUser?.displayName ? `${title.title}, ${data.appUser.displayName.split(' ')[0]}` : title.title}</h1><p>{title.description}</p></div>
          </header>}
          {content}
        </div>
      </main>

      <QueuePanel open={queueOpen} onClose={() => setQueueOpen(false)} />
      <PlayerBar onQueue={() => setQueueOpen((value) => !value)} />
      <SearchPalette open={searchOpen} suggestions={data.quickTracks} onClose={() => setSearchOpen(false)} onPlaylistPlay={playPlaylist} />
      <SessionBuilder open={sessionOpen} onClose={() => setSessionOpen(false)} />
      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} onConnected={refresh} />
      <SourcesModal open={sourcesOpen} yandexConnected={data.connected} onClose={() => { setSourcesOpen(false); if (new URLSearchParams(window.location.search).has('vkImport')) window.history.replaceState(null, '', window.location.pathname) }} onConnectYandex={() => setConnectOpen(true)} onChanged={refresh} />
      <PasswordSetupModal open={Boolean(data.appUser?.needsPassword)} onSaved={refresh} />
      <PasswordChangeModal open={passwordChangeOpen} onClose={() => setPasswordChangeOpen(false)} />
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
        {[['home', Headphones, 'Главная'], ['discover', Radio, 'Обзор'], ['library', ListMusic, 'Библиотека'], ['liked', Heart, 'Любимые'], ['history', History, 'История']].map(([id, Icon, label]) => {
          const IconComponent = Icon as typeof Headphones
          return <button key={id as string} className={!recommendationsOpen && !topOpen && view === id ? 'is-active' : ''} type="button" onClick={() => changeView(id as ViewId)}><IconComponent size={20} /><span>{label as string}</span></button>
        })}
      </nav>

      {notice && <div className="app-notice" role="status">{notice}</div>}
      {data.demo && <div className="demo-badge" data-tooltip="Сейчас показывается резервная демонстрационная коллекция"><span>{data.connected ? 'Яндекс временно недоступен · резервная выдача' : 'Демо-режим'}</span>{!data.connected && <button type="button" onClick={() => setConnectOpen(true)}>Подключить коллекцию <ChevronRight size={14} /></button>}</div>}
    </div>
  )
}

export default function App() {
  const shareMatch = window.location.pathname.match(/^\/share\/([A-Za-z0-9_-]{20,80})\/?$/)
  const profileMatch = window.location.pathname.match(/^\/users\/([A-Za-z0-9_.-]{3,32})\/?$/)
  return <>{shareMatch ? <PublicSharePage token={shareMatch[1]} /> : profileMatch ? <PublicProfilePage username={profileMatch[1]} /> : <PrivateApp />}<GlobalTooltip /></>
}
