import { Check, ListMusic, ListPlus, LoaderCircle, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { addTrackToLocalPlaylist, createLocalPlaylist, getLocalPlaylists } from '../lib/api'
import { trackGoal } from '../lib/analytics'
import type { Playlist, Track } from '../types'

export const PLAYLISTS_CHANGED_EVENT = 'xedoc:playlists-changed'

export function PlaylistPicker({ track, onAddNext, className = '' }: { track: Track; onAddNext?: () => void; className?: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [done, setDone] = useState('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const show = () => {
    setOpen((value) => !value)
    setDone('')
    if (!open) {
      setLoading(true)
      void getLocalPlaylists().then(setPlaylists).catch(() => setPlaylists([])).finally(() => setLoading(false))
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
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`playlist-picker ${className}`} ref={root}>
      <button className="icon-button" type="button" aria-label="Добавить в плейлист или очередь" aria-expanded={open} onClick={show}><ListPlus size={18} /></button>
      {open && <div className="playlist-picker__menu">
        <header><strong>Добавить трек</strong><span>{track.title}</span></header>
        {onAddNext && <button type="button" onClick={() => { onAddNext(); setOpen(false) }}><ListMusic size={17} /><span><strong>Следующим в очередь</strong><small>Сыграет после текущего</small></span></button>}
        <div className="playlist-picker__divider" />
        {loading && !playlists.length ? <div className="playlist-picker__loading"><LoaderCircle className="spin" size={18} /> Загружаем…</div> : playlists.map((playlist) => (
          <button key={playlist.id} type="button" disabled={loading} onClick={() => void add(playlist)}>
            {done === playlist.id ? <Check size={17} /> : <ListPlus size={17} />}
            <span><strong>{playlist.title}</strong><small>{playlist.trackCount} треков</small></span>
          </button>
        ))}
        {creating ? <form onSubmit={(event) => void createAndAdd(event)}><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название плейлиста" autoFocus maxLength={120} /><button type="submit" disabled={!title.trim() || loading}>Создать</button></form> : <button className="playlist-picker__create" type="button" onClick={() => setCreating(true)}><Plus size={17} /><span><strong>Новый плейлист</strong><small>Создать и сразу добавить</small></span></button>}
      </div>}
    </div>
  )
}
