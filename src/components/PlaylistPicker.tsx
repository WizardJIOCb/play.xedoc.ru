import { Check, ListMusic, ListPlus, LoaderCircle, Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { addTrackToLocalPlaylist, createLocalPlaylist, getLocalPlaylists } from '../lib/api'
import { trackGoal } from '../lib/analytics'
import type { Playlist, Track } from '../types'
import { useAuthPrompt } from '../auth/AuthPromptContext'

export const PLAYLISTS_CHANGED_EVENT = 'xedoc:playlists-changed'

export function PlaylistPicker({ track, onAddNext, className = '' }: { track: Track; onAddNext?: () => void; className?: string }) {
  const auth = useAuthPrompt()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ left: 0, top: 0, visibility: 'hidden' })
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const positionMenu = () => {
      const triggerRect = root.current?.getBoundingClientRect()
      const menuRect = menu.current?.getBoundingClientRect()
      if (!triggerRect || !menuRect) return
      const margin = 12
      const gap = 8
      const left = Math.max(margin, Math.min(triggerRect.right - menuRect.width, window.innerWidth - menuRect.width - margin))
      const fitsAbove = triggerRect.top >= menuRect.height + gap + margin
      const top = fitsAbove
        ? triggerRect.top - menuRect.height - gap
        : Math.min(triggerRect.bottom + gap, window.innerHeight - menuRect.height - margin)
      setMenuStyle({ left, top: Math.max(margin, top), visibility: 'visible' })
    }
    positionMenu()
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    return () => {
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
    }
  }, [open, loading, playlists.length, creating])

  const show = () => {
    if (!auth.requireAuth()) return
    setOpen((value) => !value)
    setDone('')
    setError('')
    if (!open) {
      setMenuStyle({ left: 0, top: 0, visibility: 'hidden' })
      setLoading(true)
      void getLocalPlaylists()
        .then(setPlaylists)
        .catch(() => {
          setPlaylists([])
          setError('Не удалось загрузить плейлисты. Попробуйте ещё раз.')
        })
        .finally(() => setLoading(false))
    }
  }

  const add = async (playlist: Playlist) => {
    setLoading(true)
    try {
      await addTrackToLocalPlaylist(playlist.id, track)
      trackGoal('playlist_track_added', { method: 'existing' })
      setDone(playlist.id)
      window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT))
      window.setTimeout(() => setOpen(false), 550)
    } catch {
      setError('Не удалось добавить трек. Попробуйте ещё раз.')
    } finally {
      setLoading(false)
    }
  }

  const createAndAdd = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    setLoading(true)
    try {
      const playlist = await createLocalPlaylist(title.trim())
      await addTrackToLocalPlaylist(playlist.id, track)
      trackGoal('playlist_created', { isPublic: false })
      trackGoal('playlist_track_added', { method: 'new' })
      window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT))
      setOpen(false)
      setTitle('')
      setCreating(false)
    } catch {
      setError('Не удалось создать плейлист. Попробуйте ещё раз.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`playlist-picker ${className}`} ref={root}>
      <button className="icon-button" type="button" aria-label={`Добавить ${track.title} в плейлист или очередь`} aria-expanded={open} onClick={show}><ListPlus size={18} /></button>
      {open && createPortal(<div className="playlist-picker__menu" ref={menu} style={menuStyle}>
        <header><strong>Добавить трек</strong><span>{track.title}</span></header>
        {onAddNext && <button type="button" onClick={() => { onAddNext(); setOpen(false) }}><ListMusic size={17} /><span><strong>Следующим в очередь</strong><small>Сыграет после текущего</small></span></button>}
        <div className="playlist-picker__divider" />
        {loading && !playlists.length ? <div className="playlist-picker__loading"><LoaderCircle className="spin" size={18} /> Загружаем…</div> : playlists.map((playlist) => (
          <button key={playlist.id} type="button" disabled={loading} onClick={() => void add(playlist)}>
            {done === playlist.id ? <Check size={17} /> : <ListPlus size={17} />}
            <span><strong>{playlist.title}</strong><small>{playlist.trackCount} треков</small></span>
          </button>
        ))}
        {error && <div className="playlist-picker__error" role="alert">{error}</div>}
        {creating ? <form onSubmit={(event) => void createAndAdd(event)}><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название плейлиста" autoFocus maxLength={120} /><button type="submit" disabled={!title.trim() || loading}>Создать</button></form> : <button className="playlist-picker__create" type="button" onClick={() => setCreating(true)}><Plus size={17} /><span><strong>Новый плейлист</strong><small>Создать и сразу добавить</small></span></button>}
      </div>, document.body)}
    </div>
  )
}
