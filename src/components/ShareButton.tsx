import { Check, LoaderCircle, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPlaylistShare, createTrackShare } from '../lib/api'
import type { Playlist, Track } from '../types'

type ShareButtonProps = ({ track: Track; playlist?: never } | { playlist: Playlist; track?: never }) & {
  labeled?: boolean
  className?: string
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
    document.execCommand('copy')
    field.remove()
  }
}

export function ShareButton({ track, playlist, labeled = false, className = '' }: ShareButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const title = track?.title || playlist?.title || 'Музыка'
  const unavailable = Boolean(track?.id.startsWith('demo-') || playlist?.id.startsWith('demo-'))

  useEffect(() => {
    if (state !== 'done' && state !== 'error') return
    const timeout = window.setTimeout(() => setState('idle'), 2600)
    return () => window.clearTimeout(timeout)
  }, [state])

  const share = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (state === 'loading') return
    setState('loading')
    try {
      const link = track ? await createTrackShare(track) : await createPlaylistShare(playlist!.id)
      const url = new URL(link.path, window.location.origin).toString()
      if (navigator.share) {
        try {
          await navigator.share({ title: `${title} — XEDOC Play`, text: `Послушайте «${title}»`, url })
          setState('done')
          return
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            setState('idle')
            return
          }
        }
      }
      await copyText(url)
      setState('done')
    } catch {
      setState('error')
    }
  }

  const label = state === 'loading'
    ? 'Создаём ссылку…'
    : state === 'done'
      ? 'Ссылка готова'
      : state === 'error'
        ? 'Не удалось'
        : 'Поделиться'
  const buttonLabel = unavailable ? 'Доступно после подключения Яндекс Музыки' : label

  return (
    <button
      className={`share-button ${labeled ? 'share-button--labeled' : 'icon-button'} ${className}`}
      type="button"
      onClick={(event) => void share(event)}
      aria-label={`${buttonLabel}: ${title}`}
      title={buttonLabel}
      disabled={state === 'loading' || unavailable}
    >
      {state === 'loading' ? <LoaderCircle className="spin" size={17} /> : state === 'done' ? <Check size={17} /> : <Share2 size={17} />}
      {labeled && <span>{unavailable ? 'Поделиться' : label}</span>}
    </button>
  )
}
