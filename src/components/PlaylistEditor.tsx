import { Camera, Globe2, LoaderCircle, LockKeyhole, Save, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createLocalPlaylist, deleteLocalPlaylist, getPlaylist, removeTrackFromLocalPlaylist, updateLocalPlaylist, updateLocalPlaylistCover } from '../lib/api'
import { trackGoal } from '../lib/analytics'
import type { Playlist } from '../types'
import { CoverArt } from './CoverArt'
import { ArtistLinks } from './ArtistLinks'
import { PLAYLISTS_CHANGED_EVENT } from './PlaylistPicker'

async function imageDataUrl(file: File): Promise<string> {
  if (!file.type.match(/^image\/(jpeg|png|webp)$/)) throw new Error('Выберите JPEG, PNG или WebP')
  const bitmap = await createImageBitmap(file)
  const size = Math.min(900, Math.max(bitmap.width, bitmap.height))
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', .86)
}

export function PlaylistEditor({ open, playlist, onClose, onSaved, onDeleted }: { open: boolean; playlist?: Playlist; onClose: () => void; onSaved: (playlist: Playlist) => void; onDeleted?: () => void }) {
  const [loaded, setLoaded] = useState<Playlist | undefined>(playlist)
  const [title, setTitle] = useState(playlist?.title || '')
  const [description, setDescription] = useState(playlist?.description || playlist?.subtitle || '')
  const [isPublic, setIsPublic] = useState(Boolean(playlist?.isPublic))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setLoaded(playlist)
    setTitle(playlist?.title || '')
    setDescription(playlist?.description || playlist?.subtitle || '')
    setIsPublic(Boolean(playlist?.isPublic))
    setError('')
    if (playlist?.id && !playlist.tracks) void getPlaylist(playlist.id).then((value) => {
      setLoaded(value)
      setTitle(value.title)
      setDescription(value.description || value.subtitle || '')
      setIsPublic(Boolean(value.isPublic))
    }).catch(() => setError('Не удалось загрузить плейлист'))
  }, [open, playlist])

  if (!open) return null

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    setError('')
    try {
      const value = loaded?.id
        ? await updateLocalPlaylist(loaded.id, { title: title.trim(), description: description.trim(), isPublic })
        : await createLocalPlaylist(title.trim(), description.trim(), isPublic)
      if (!loaded?.id) trackGoal('playlist_created', { isPublic })
      setLoaded(value)
      window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT))
      onSaved(value)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить плейлист')
    } finally {
      setBusy(false)
    }
  }

  const cover = async (file?: File) => {
    if (!file || !loaded) return
    setBusy(true)
    setError('')
    try {
      const value = await updateLocalPlaylistCover(loaded.id, await imageDataUrl(file))
      setLoaded(value)
      window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT))
      onSaved(value)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось обновить обложку')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (trackId: string) => {
    if (!loaded) return
    setBusy(true)
    try {
      const value = await removeTrackFromLocalPlaylist(loaded.id, trackId)
      setLoaded(value)
      window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT))
      onSaved(value)
    } finally {
      setBusy(false)
    }
  }

  const destroy = async () => {
    if (!loaded || !window.confirm(`Удалить плейлист «${loaded.title}»? Треки останутся в Яндекс Музыке.`)) return
    setBusy(true)
    try {
      await deleteLocalPlaylist(loaded.id)
      window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT))
      onDeleted?.()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="playlist-editor" role="dialog" aria-modal="true" aria-label={loaded ? 'Редактирование плейлиста' : 'Новый плейлист'}>
        <header><div><span className="eyebrow">XEDOC PLAYLIST</span><h2>{loaded ? 'Настроить плейлист' : 'Новый плейлист'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть"><X size={20} /></button></header>
        <div className="playlist-editor__body">
          <div className="playlist-editor__cover-wrap">
            <CoverArt title={title || 'Новый плейлист'} url={loaded?.coverUrl} tone={loaded?.coverTone || 'violet'} className="playlist-editor__cover" />
            {loaded ? <label className="secondary-button"><Camera size={17} /> Сменить обложку<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(event) => void cover(event.target.files?.[0])} /></label> : <small>Обложку можно выбрать после создания</small>}
          </div>
          <form id="playlist-editor-form" onSubmit={(event) => void save(event)}>
            <label>Название<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Например, Вечер без спешки" autoFocus /></label>
            <label>Описание<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={5} placeholder="О чём этот плейлист? Ссылки https://… станут кликабельными." /></label>
            <small>{description.length}/4000 · ссылки в описании распознаются автоматически</small>
            <label className={`playlist-visibility ${isPublic ? 'is-public' : ''}`}>
              <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
              <span className="playlist-visibility__icon">{isPublic ? <Globe2 size={19} /> : <LockKeyhole size={19} />}</span>
              <span><strong>{isPublic ? 'Публичный плейлист' : 'Приватный плейлист'}</strong><small>{isPublic ? 'Его увидят в вашем профиле и смогут послушать без регистрации.' : 'Плейлист виден только вам.'}</small></span>
              <i aria-hidden="true" />
            </label>
          </form>
        </div>
        {loaded && <div className="playlist-editor__tracks"><div><strong>Треки</strong><span>{loaded.tracks?.length || 0}</span></div>{loaded.tracks?.map((track) => <div key={track.id}><CoverArt title={track.title} url={track.coverUrl} tone={track.coverTone} className="playlist-editor__track-cover" /><span><strong>{track.title}</strong><ArtistLinks artists={track.artists} /></span><button className="icon-button" type="button" disabled={busy} onClick={() => void remove(track.id)} aria-label={`Убрать ${track.title}`}><X size={17} /></button></div>)}</div>}
        {error && <div className="form-error playlist-editor__error">{error}</div>}
        <footer>{loaded ? <button className="playlist-editor__delete" type="button" disabled={busy} onClick={() => void destroy()}><Trash2 size={17} /> Удалить</button> : <span />}<div><button className="secondary-button" type="button" onClick={onClose}>Отмена</button><button className="primary-button" type="submit" form="playlist-editor-form" disabled={busy || !title.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Сохранить</button></div></footer>
      </section>
    </div>
  )
}
