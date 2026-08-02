import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Command,
  Disc3,
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
  Radio,
  Search,
  Shuffle,
  Sparkles,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConnectModal } from './components/ConnectModal'
import { CoverArt } from './components/CoverArt'
import { PlayerBar } from './components/PlayerBar'
import { PlaylistCard } from './components/PlaylistCard'
import { SearchPalette } from './components/SearchPalette'
import { SessionBuilder } from './components/SessionBuilder'
import { Sidebar } from './components/Sidebar'
import { TrackRow } from './components/TrackRow'
import { demoBootstrap } from './data/demo'
import { getBootstrap, getPlaylist, logout, unlockAccess } from './lib/api'
import { usePlayer } from './player/PlayerContext'
import type { BootstrapPayload, Playlist, Track, ViewId } from './types'

const viewTitles: Record<ViewId, { eyebrow: string; title: string; description: string }> = {
  home: { eyebrow: 'ВОСКРЕСЕНЬЕ · ВАШ РИТМ', title: 'Добрый день', description: 'Музыка, которая подходит именно сейчас.' },
  discover: { eyebrow: 'ОБЗОР', title: 'Найти новое', description: 'Знакомые ориентиры, неожиданные повороты.' },
  library: { eyebrow: 'КОЛЛЕКЦИЯ', title: 'Ваша библиотека', description: 'Всё важное — без лишних витрин.' },
  liked: { eyebrow: 'МНЕ НРАВИТСЯ', title: 'Любимые треки', description: 'Музыка, к которой хочется возвращаться.' },
  history: { eyebrow: 'ИСТОРИЯ', title: 'Недавно слушали', description: 'Вернуться ровно туда, где остановились.' },
}

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

function HomeView({ data, onSession, onPlaylist, onPlaylistPlay }: { data: BootstrapPayload; onSession: () => void; onPlaylist: (playlist: Playlist) => void; onPlaylistPlay: (playlist: Playlist) => void }) {
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
          <div className="hero-session__core"><Disc3 size={38} /><strong>58%</strong><small>нового</small></div>
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

      <section className="content-section rediscover-section">
        <SectionHeader title="Давно не слушали" hint="Любимые треки, которые затерялись в коллекции" action="Ещё 20" />
        <div className="track-table">
          {data.rediscover.map((track, index) => <TrackRow key={track.id} track={track} context={data.rediscover} index={index} />)}
        </div>
      </section>
    </>
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

function LibraryView({ data, onPlaylist, onPlaylistPlay, onSession }: { data: BootstrapPayload; onPlaylist: (playlist: Playlist) => void; onPlaylistPlay: (playlist: Playlist) => void; onSession: () => void }) {
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const playlists = filter === 'mine' ? data.playlists : data.playlists.concat(data.recommendations.slice(0, 2))
  return (
    <>
      <div className="library-toolbar">
        <div className="filter-pills"><button className={filter === 'all' ? 'is-active' : ''} type="button" onClick={() => setFilter('all')}>Все</button><button className={filter === 'mine' ? 'is-active' : ''} type="button" onClick={() => setFilter('mine')}>Мои</button></div>
        <div className="layout-switch"><button className={layout === 'grid' ? 'is-active' : ''} type="button" onClick={() => setLayout('grid')} aria-label="Сетка"><Menu size={17} /></button><button className={layout === 'list' ? 'is-active' : ''} type="button" onClick={() => setLayout('list')} aria-label="Список"><ListMusic size={17} /></button></div>
      </div>
      <section className="content-section content-section--first">
        <SectionHeader title="Плейлисты" hint={`${data.playlists.length} коллекции · синхронизировано с Яндекс Музыкой`} action="Новый плейлист" />
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

function PlaylistDetailView({ playlist, loading, error, onBack }: { playlist: Playlist; loading: boolean; error?: string; onBack: () => void }) {
  const player = usePlayer()
  const tracks = playlist.tracks || []
  return (
    <section className="playlist-detail">
      <button className="playlist-detail__back" type="button" onClick={onBack}><ArrowLeft size={16} /> Назад к библиотеке</button>
      <header className="playlist-detail__hero">
        <CoverArt title={playlist.title} url={playlist.coverUrl} tone={playlist.coverTone} className="playlist-detail__cover" />
        <div className="playlist-detail__meta">
          <span className="eyebrow">ПЛЕЙЛИСТ</span>
          <h1>{playlist.title}</h1>
          <p>{playlist.subtitle || 'Ваша коллекция в Яндекс Музыке'}</p>
          <span>{playlist.trackCount} треков{playlist.durationMinutes ? ` · ${Math.floor(playlist.durationMinutes / 60)} ч ${playlist.durationMinutes % 60} мин` : ''}</span>
          <div><button className="primary-button" type="button" disabled={!tracks.length} onClick={() => player.playQueue(tracks)}><Play size={18} fill="currentColor" /> Слушать</button><button className="secondary-button" type="button" disabled={!tracks.length} onClick={() => player.playQueue([...tracks].sort(() => Math.random() - .5))}><Shuffle size={17} /> Перемешать</button></div>
        </div>
      </header>
      <div className="playlist-detail__summary"><span><Sparkles size={15} /> XEDOC-анализ</span><p><strong>{new Set(tracks.flatMap((track) => track.artists)).size || '—'} артистов</strong><i />повторы разведены по очереди<i />можно собрать сессию без треков последних 30 дней</p></div>
      {loading ? <div className="playlist-detail__loading"><LoaderCircle className="spin" size={23} /> Загружаем треки…</div> : error ? <div className="playlist-detail__loading form-error">{error}</div> : tracks.length ? (
        <div className="track-table track-table--large">{tracks.map((track, index) => <TrackRow key={`${track.id}-${index}`} track={track} context={tracks} index={index} />)}</div>
      ) : <div className="playlist-detail__loading">В этом плейлисте пока нет треков.</div>}
    </section>
  )
}

function TrackCollectionView({ type, tracks, total }: { type: 'liked' | 'history'; tracks: Track[]; total?: number }) {
  const player = usePlayer()
  return (
    <section className="content-section content-section--first">
      <div className="collection-summary">
        <div className={`collection-summary__icon collection-summary__icon--${type}`}>{type === 'liked' ? <Heart size={34} fill="currentColor" /> : <History size={34} />}</div>
        <div><span className="eyebrow">{type === 'liked' ? 'ВАША КОЛЛЕКЦИЯ' : 'НА ЭТОМ УСТРОЙСТВЕ'}</span><h2>{type === 'liked' ? `${total ?? tracks.length} любимых треков` : 'История прослушивания'}</h2><p>{type === 'liked' ? `Показываем ${tracks.length} последних треков из синхронизированной коллекции.` : 'История хранится локально и помогает убирать повторы.'}</p></div>
        <button className="primary-button" type="button" disabled={!tracks.length} onClick={() => player.playQueue(tracks)}><Play size={18} fill="currentColor" /> Слушать</button>
      </div>
      <div className="track-table track-table--large">
        {tracks.map((track, index) => <TrackRow key={`${track.id}-${index}`} track={track} context={tracks} index={index} />)}
      </div>
      {!tracks.length && <div className="playlist-detail__loading">{type === 'history' ? 'Здесь появятся треки после первого прослушивания.' : 'В текущей выдаче пока нет любимых треков.'}</div>}
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

function AccessGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await unlockAccess(key)
      onUnlocked()
    } catch {
      setError('Ключ не подошёл')
    } finally {
      setLoading(false)
    }
  }
  return (
    <main className="access-gate">
      <div className="access-gate__glow" />
      <form onSubmit={(event) => void submit(event)}>
        <span className="brand__mark">X</span><span className="eyebrow">XEDOC PLAY · PRIVATE BETA</span><h1>Музыка без лишнего.</h1><p>Введите ключ доступа к вашей персональной версии плеера.</p>
        <label><KeyRound size={18} /><input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Ключ доступа" autoFocus /></label>
        <button className="primary-button" type="submit" disabled={!key || loading}>{loading ? <LoaderCircle className="spin" size={18} /> : 'Войти'} {!loading && <ChevronRight size={18} />}</button>
        {error && <span className="form-error">{error}</span>}
        <small>Доступ защищает подключённый аккаунт и личные рекомендации.</small>
      </form>
    </main>
  )
}

export default function App() {
  const [data, setData] = useState<BootstrapPayload>(() => ({ ...demoBootstrap, accessLocked: true }))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState<ViewId>('home')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist>()
  const [playlistLoading, setPlaylistLoading] = useState(false)
  const [playlistError, setPlaylistError] = useState('')
  const [notice, setNotice] = useState('')
  const player = usePlayer()

  const refresh = useCallback(() => {
    setLoading(true)
    setLoadError('')
    void getBootstrap()
      .then(setData)
      .catch(() => setLoadError('Сервер плеера временно недоступен. Проверьте соединение и попробуйте ещё раз.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(refresh, [refresh])

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
    if (playlist.tracks?.length) {
      player.playQueue(playlist.tracks)
      return
    }
    void getPlaylist(playlist.id)
      .then((loaded) => {
        if (loaded.tracks?.length) player.playQueue(loaded.tracks)
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
    setView(nextView)
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
    if (selectedPlaylist) return <PlaylistDetailView playlist={selectedPlaylist} loading={playlistLoading} error={playlistError} onBack={() => setSelectedPlaylist(undefined)} />
    if (view === 'home') return <HomeView data={data} onSession={() => setSessionOpen(true)} onPlaylist={openPlaylist} onPlaylistPlay={playPlaylist} />
    if (view === 'discover') return <DiscoverView data={data} onSession={() => setSessionOpen(true)} onPlaylist={openPlaylist} onPlaylistPlay={playPlaylist} />
    if (view === 'library') return <LibraryView data={data} onPlaylist={openPlaylist} onPlaylistPlay={playPlaylist} onSession={() => setSessionOpen(true)} />
    if (view === 'liked') return <TrackCollectionView type="liked" tracks={data.likedTracks} total={data.likedCount} />
    return <TrackCollectionView type="history" tracks={player.history} />
  }, [data, openPlaylist, playPlaylist, player.history, playlistError, playlistLoading, selectedPlaylist, view])

  if (loading && data.accessLocked) return <div className="app-loader"><LoaderCircle className="spin" size={28} /><span>Загружаем музыку…</span></div>
  if (loadError) return <main className="access-gate"><div className="access-gate__glow" /><form><span className="brand__mark">X</span><span className="eyebrow">XEDOC PLAY</span><h1>Не удалось подключиться.</h1><p>{loadError}</p><button className="primary-button" type="button" onClick={refresh}>Повторить</button></form></main>
  if (data.accessLocked) return <AccessGate onUnlocked={refresh} />

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'app-shell--compact' : ''} ${queueOpen ? 'app-shell--queue' : ''}`}>
      <Sidebar view={view} playlists={data.playlists} collapsed={sidebarCollapsed} onView={changeView} onToggle={() => setSidebarCollapsed((value) => !value)} onSession={() => setSessionOpen(true)} />
      <main className="main-view">
        <header className="topbar">
          <div className="topbar__history"><button className="icon-button" type="button" aria-label="Назад" disabled={!selectedPlaylist} onClick={() => setSelectedPlaylist(undefined)}><ArrowLeft size={18} /></button></div>
          <button className="topbar__search" type="button" onClick={() => setSearchOpen(true)}><Search size={18} /><span>Найти музыку</span><kbd><Command size={13} /> K</kbd></button>
          <div className="topbar__actions">
            {data.connected ? (
              <div className="profile-chip"><span className="profile-chip__avatar">{data.user?.name?.[0] || 'Я'}</span><span><strong>{data.user?.name || 'Моя музыка'}</strong><small><CheckCircle2 size={12} /> подключено</small></span><button className="icon-button" type="button" onClick={() => { player.clear(); void logout().then(refresh) }} aria-label="Отключить аккаунт"><LogOut size={16} /></button></div>
            ) : (
              <button className="connect-button" type="button" onClick={() => setConnectOpen(true)}><Headphones size={17} /> Подключить Яндекс Музыку</button>
            )}
          </div>
        </header>

        <div className="page-content">
          {!selectedPlaylist && <header className="page-heading">
            <div><span className="eyebrow">{title.eyebrow}</span><h1>{view === 'home' && data.user?.name ? `${title.title}, ${data.user.name.split(' ')[0]}` : title.title}</h1><p>{title.description}</p></div>
          </header>}
          {content}
        </div>
      </main>

      <QueuePanel open={queueOpen} onClose={() => setQueueOpen(false)} />
      <PlayerBar onQueue={() => setQueueOpen((value) => !value)} />
      <SearchPalette open={searchOpen} suggestions={data.quickTracks} onClose={() => setSearchOpen(false)} onPlaylistPlay={playPlaylist} />
      <SessionBuilder open={sessionOpen} onClose={() => setSessionOpen(false)} />
      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} onConnected={refresh} />

      <nav className="mobile-nav" aria-label="Мобильная навигация">
        {[['home', Headphones, 'Главная'], ['discover', Radio, 'Обзор'], ['library', ListMusic, 'Библиотека'], ['liked', Heart, 'Любимые'], ['history', History, 'История']].map(([id, Icon, label]) => {
          const IconComponent = Icon as typeof Headphones
          return <button key={id as string} className={view === id ? 'is-active' : ''} type="button" onClick={() => changeView(id as ViewId)}><IconComponent size={20} /><span>{label as string}</span></button>
        })}
      </nav>

      {notice && <div className="app-notice" role="status">{notice}</div>}
      {data.demo && <div className="demo-badge"><span>{data.connected ? 'Яндекс временно недоступен · резервная выдача' : 'Демо-режим'}</span>{!data.connected && <button type="button" onClick={() => setConnectOpen(true)}>Подключить коллекцию <ChevronRight size={14} /></button>}</div>}
    </div>
  )
}
