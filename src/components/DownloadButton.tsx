import { Download, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import type { Track } from '../types'

export function DownloadButton({ track, className = '' }: { track: Track; className?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const unavailable = track.id.startsWith('demo-')

  const download = async () => {
    if (busy || unavailable) return
    setBusy(true)
    setError('')
    try {
      const url = new URL(track.streamUrl || `/api/tracks/${encodeURIComponent(track.id)}/stream`, window.location.origin)
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) throw new Error('Скачивание из этого источника недоступно')
      const name = `${track.artists.join(', ')} - ${track.title}`.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').slice(0, 160).replace(/[. ]+$/, '') || 'track'
      url.searchParams.set('download', '1')
      url.searchParams.set('filename', name)
      const response = await fetch(url.href, { credentials: 'same-origin' })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(typeof body?.detail === 'string' ? body.detail : 'Не удалось скачать трек. Попробуйте ещё раз.')
      }
      const blob = await response.blob()
      if (!blob.size || (!blob.type.startsWith('audio/') && !['application/octet-stream', 'application/ogg'].includes(blob.type))) throw new Error('Источник не вернул аудиофайл')
      const extensions: Record<string, string> = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'application/ogg': 'ogg' }
      const disposition = response.headers.get('content-disposition') || ''
      const extension = disposition.match(/\.(mp3|wav|flac|m4a|aac|ogg)(?:[";]|$)/i)?.[1] || extensions[blob.type] || 'mp3'
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `${name}.${extension}`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось скачать трек')
    } finally {
      setBusy(false)
    }
  }

  return <span className={`download-control ${className}`}>
    <button className="icon-button download-button" type="button" disabled={busy || unavailable} aria-label={`${busy ? 'Скачиваем' : 'Скачать'} ${track.title}`} title={unavailable ? 'В демо-режиме скачивание недоступно' : 'Скачать трек'} onClick={(event) => { event.stopPropagation(); void download() }}>
      {busy ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />}
    </button>
    {error && <span className="download-control__error" role="alert" onClick={(event) => event.stopPropagation()}>{error}</span>}
  </span>
}
