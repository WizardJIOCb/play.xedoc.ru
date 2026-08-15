import { BarChart3, Compass, Heart, History, Home, Library, ListMusic, PanelLeftClose, PanelLeftOpen, Plus, Rss, Sparkles, UsersRound } from 'lucide-react'
import type { Playlist, ViewId } from '../types'
import { CoverArt } from './CoverArt'

const navigation: Array<{ id: ViewId; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'feed', label: 'Лента', icon: Rss },
  { id: 'friends', label: 'Друзья', icon: UsersRound },
  { id: 'discover', label: 'Обзор', icon: Compass },
  { id: 'library', label: 'Библиотека', icon: Library },
]

export function Sidebar({
  view,
  playlists,
  collapsed,
  recommendationsActive,
  topActive,
  onView,
  onRecommendations,
  onTop,
  onPlaylist,
  onCreatePlaylist,
  onToggle,
  onSession,
}: {
  view: ViewId | null
  playlists: Playlist[]
  collapsed: boolean
  recommendationsActive: boolean
  topActive: boolean
  onView: (view: ViewId) => void
  onRecommendations: () => void
  onTop: () => void
  onPlaylist: (playlist: Playlist) => void
  onCreatePlaylist: () => void
  onToggle: () => void
  onSession: () => void
}) {
  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <button className="brand sidebar__brand" type="button" onClick={() => onView('home')} aria-label="На главную">
        <span className="brand__mark">X</span>
        <span className="brand__word"><strong>XEDOC</strong><small>PLAY</small></span>
      </button>

      <nav className="sidebar__nav" aria-label="Основная навигация">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button key={id} className={!recommendationsActive && !topActive && view === id ? 'is-active' : ''} type="button" onClick={() => onView(id)} aria-label={label}>
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
        <button className={recommendationsActive ? 'is-active' : ''} type="button" onClick={onRecommendations} aria-label="Рекомендации">
          <Sparkles size={20} />
          <span>Рекомендации</span>
        </button>
        <button className={topActive ? 'is-active' : ''} type="button" onClick={onTop} aria-label="Топ треков">
          <BarChart3 size={20} />
          <span>Топ треков</span>
        </button>
      </nav>

      <button className="sidebar__session" type="button" onClick={onSession} aria-label="Собрать сессию">
        <Plus size={18} />
        <span>Собрать сессию</span>
      </button>

      <div className="sidebar__section">
        <p>Моя музыка</p>
        <button className={view === 'liked' ? 'is-active' : ''} type="button" onClick={() => onView('liked')} aria-label="Любимые">
          <Heart size={18} /> <span>Любимые</span>
        </button>
        <button className={view === 'history' ? 'is-active' : ''} type="button" onClick={() => onView('history')} aria-label="История">
          <History size={18} /> <span>История</span>
        </button>
      </div>

      <div className="sidebar__section sidebar__playlists">
        <div className="sidebar__playlist-heading">
          <button className="sidebar__section-title" type="button" onClick={() => onView('library')} aria-label="Показать все плейлисты">
            <span>Недавние</span><ListMusic size={16} />
          </button>
          <button className="sidebar__playlist-create" type="button" onClick={onCreatePlaylist} aria-label="Новый плейлист">+ Новый</button>
        </div>
        {playlists.slice(0, 4).map((playlist) => (
          <button key={playlist.id} className="sidebar__playlist" type="button" onClick={() => onPlaylist(playlist)} aria-label={`Открыть плейлист ${playlist.title}`}>
            <CoverArt title={playlist.title} url={playlist.coverUrl} tone={playlist.coverTone} className="sidebar__cover" />
            <span><strong>{playlist.title}</strong><small>{playlist.trackCount} треков</small></span>
          </button>
        ))}
      </div>

      <div className="sidebar__footer">
        <button className="icon-button" type="button" onClick={onToggle} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>
          {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
        </button>
      </div>
    </aside>
  )
}
