import { Check, Clock3, LoaderCircle, Share2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPlaylistShare, createTrackShare } from '../lib/api'
import { trackGoal } from '../lib/analytics'
import type { Playlist, Track } from '../types'
import { useAuthPrompt } from '../auth/AuthPromptContext'

type ShareButtonProps = ({ track: Track; playlist?: never } | { playlist: Playlist; track?: never }) & {
  labeled?: boolean
  className?: string
  startAtSeconds?: number
}

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    return
  } catch {
    const field = document.createElement('textarea')
    field.value = value
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    try {
      if (!document.execCommand('copy')) throw new Error('Clipboard copy was rejected')
    } finally {
      field.remove()
    }
  }
}

export function ShareButton({ track, playlist, labeled = false, className = '', startAtSeconds = 0 }: ShareButtonProps) {
  const auth = useAuthPrompt()
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [startAt, setStartAt] = useState('0')
  const inputRef = useRef<HTMLInputElement>(null)
  const title = track?.title || playlist?.title || 'Музыка'
  const unavailable = Boolean(track?.id.startsWith('demo-') || playlist?.id.startsWith('demo-'))
  const durationSeconds = Math.max(0, Math.floor((track?.durationMs || 0) / 1000))

  useEffect(() => {
    if (state !== 'done' && state !== 'error') return
    const timeout = window.setTimeout(() => setState('idle'), 2600)
    return () => window.clearTimeout(timeout)
  }, [state])

  useEffect(() => {
    if (!dialogOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && state !== 'loading') setDialogOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.setTimeout(() => inputRef.current?.select(), 30)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialogOpen, state])

  const copyShare = async (requestedStartAt?: number) => {
    if (state === 'loading') return
    setState('loading')
    try {
      const link = track ? await createTrackShare(track) : await createPlaylistShare(playlist!.id)
      trackGoal('share_created', { resourceType: track ? 'track' : 'playlist' })
      const url = new URL(link.path, window.location.origin)
      if (track && requestedStartAt !== undefined) url.searchParams.set('t', String(requestedStartAt))
      await copyText(url.toString())
      setState('done')
      setDialogOpen(false)
    } catch {
      setState('error')
    }
  }

  const share = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (state === 'loading' || !auth.requireAuth()) return
    if (!track) {
      void copyShare()
      return
    }
    const requestedStartAt = Number.isFinite(startAtSeconds) ? Math.floor(startAtSeconds) : 0
    const initialStartAt = Math.max(0, Math.min(requestedStartAt, Math.max(0, durationSeconds - 1)))
    setStartAt(String(initialStartAt))
    setDialogOpen(true)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const requested = Number(startAt)
    const normalized = Number.isFinite(requested)
      ? Math.max(0, Math.min(Math.floor(requested), Math.max(0, durationSeconds - 1)))
      : 0
    setStartAt(String(normalized))
    void copyShare(normalized)
  }

  const label = state === 'loading'
    ? 'Создаём ссылку…'
    : state === 'done'
      ? 'Ссылка скопирована'
      : state === 'error'
        ? 'Не удалось скопировать'
        : 'Поделиться'
  const buttonLabel = unavailable ? 'Доступно после подключения Яндекс Музыки' : label

  return (
    <>
      <button
        className={`share-button ${labeled ? 'share-button--labeled' : 'icon-button'} ${className}`}
        type="button"
        onClick={share}
        aria-label={`${buttonLabel}: ${title}`}
        title={buttonLabel}
        data-tooltip={state === 'idle' ? buttonLabel : undefined}
        disabled={state === 'loading' || unavailable}
      >
        {state === 'loading' ? <LoaderCircle className="spin" size={17} /> : state === 'done' ? <Check size={17} /> : <Share2 size={17} />}
        {labeled && <span>{unavailable ? 'Поделиться' : label}</span>}
        {(state === 'done' || state === 'error') && <span className={`share-button__feedback ${state === 'error' ? 'share-button__feedback--error' : ''}`} role="status">{label}</span>}
      </button>
      {dialogOpen && track && (
        <div className="modal-backdrop share-dialog-backdrop" role="presentation" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => {
          event.stopPropagation()
          if (event.target === event.currentTarget && state !== 'loading') setDialogOpen(false)
        }}>
          <form className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" onSubmit={submit}>
            <header>
              <div className="share-dialog__icon"><Clock3 size={21} /></div>
              <div><span className="eyebrow">ССЫЛКА НА ФРАГМЕНТ</span><h2 id="share-dialog-title">С какой секунды включить?</h2></div>
              <button className="icon-button" type="button" onClick={() => setDialogOpen(false)} aria-label="Закрыть" disabled={state === 'loading'}><X size={19} /></button>
            </header>
            <p><strong>{track.title}</strong> начнёт играть автоматически с указанного места.</p>
            <label className="share-dialog__time">
              <span>Начать с секунды</span>
              <span><input ref={inputRef} type="number" min="0" max={Math.max(0, durationSeconds - 1)} step="1" inputMode="numeric" value={startAt} onChange={(event) => setStartAt(event.target.value)} aria-label="Начать с секунды" /> <small>{formatTime(Number(startAt) || 0)} из {formatTime(durationSeconds)}</small></span>
            </label>
            <footer>
              <button className="secondary-button" type="button" onClick={() => setDialogOpen(false)} disabled={state === 'loading'}>Отмена</button>
              <button className="primary-button" type="submit" disabled={state === 'loading'}>{state === 'loading' ? <LoaderCircle className="spin" size={17} /> : <Share2 size={17} />} Скопировать ссылку</button>
            </footer>
          </form>
        </div>
      )}
    </>
  )
}
