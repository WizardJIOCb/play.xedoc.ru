import { Clock3, Compass, Heart, History, Home, Library, ListMusic, PanelLeftClose, PanelLeftOpen, Plus, Sparkles } from 'lucide-react'
import type { Playlist, ViewId } from '../types'
import { CoverArt } from './CoverArt'

const navigation: Array<{ id: ViewId; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'discover', label: 'Обзор', icon: Compass },
  { id: 'library', label: 'Библиотека', icon: Library },
]

export function Sidebar({
  view,
  playlists,
  collapsed,
  recommendationsActive,
  onView,
  onRecommendations,
  onToggle,
  onSession,
}: {
  view: ViewId
  playlists: Playlist[]
  collapsed: boolean
  recommendationsActive: boolean
  onView: (view: ViewId) => void
  onRecommendations: () => void
  onToggle: () => void
  onSession: () => void
}) {
  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="brand">
        <span className="brand__mark">X</span>
        <span className="brand__word"><strong>XEDOC</strong><small>PLAY</small></span>
      </div>

      <nav className="sidebar__nav" aria-label="Основная навигация">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button key={id} className={!recommendationsActive && view === id ? 'is-active' : ''} type="button" onClick={() => onView(id)} title={collapsed ? label : undefined}>
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
        <button className={recommendationsActive ? 'is-active' : ''} type="button" onClick={onRecommendations} title={collapsed ? 'Рекомендации' : undefined}>
          <Sparkles size={20} />
          <span>Рекомендации</span>
        </button>
      </nav>

      <button className="sidebar__session" type="button" onClick={onSession} title={collapsed ? 'Собрать сессию' : undefined} aria-label="Собрать сессию">
        <Plus size={18} />
        <span>Собрать сессию</span>
      </button>

      <div className="sidebar__section">
        <p>Моя музыка</p>
        <button className={view === 'liked' ? 'is-active' : ''} type="button" onClick={() => onView('liked')} title={collapsed ? 'Любимые' : undefined}>
          <Heart size={18} /> <span>Любимые</span>
        </button>
        <button className={view === 'history' ? 'is-active' : ''} type="button" onClick={() => onView('history')} title={collapsed ? 'История' : undefined}>
          <History size={18} /> <span>История</span>
        </button>
      </div>

      <div className="sidebar__section sidebar__playlists">
        <div className="sidebar__section-title"><p>Недавние</p><ListMusic size={16} /></div>
        {playlists.slice(0, 4).map((playlist) => (
          <button key={playlist.id} className="sidebar__playlist" type="button" onClick={() => onView('library')}>
            <CoverArt title={playlist.title} url={playlist.coverUrl} tone={playlist.coverTone} className="sidebar__cover" />
            <span><strong>{playlist.title}</strong><small>{playlist.trackCount} треков</small></span>
          </button>
        ))}
      </div>

      <div className="sidebar__footer">
        {!collapsed && <span><Clock3 size={15} /> Без повторов: 30 дней</span>}
        <button className="icon-button" type="button" onClick={onToggle} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>
          {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
        </button>
      </div>
    </aside>
  )
}
