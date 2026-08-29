import { ArrowLeft, Headphones, LoaderCircle, Play, Share2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getPublicShare } from '../lib/api'
import { usePlayer } from '../player/PlayerContext'
import type { PublicShare, Track } from '../types'
import { ArtistLinks } from './ArtistLinks'
import { CoverArt } from './CoverArt'
import { PlayerBar } from './PlayerBar'
import { TrackRow } from './TrackRow'

function shareStartAtSeconds() {
  const raw = new URLSearchParams(window.location.search).get('t')
  if (raw === null || !/^\d+(?:\.\d+)?$/.test(raw)) return null
  const value = Number(raw)
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null
}

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

export function PublicSharePage({ token }: { token: string }) {
  const [share, setShare] = useState<PublicShare>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [requestedStartAtSeconds] = useState(shareStartAtSeconds)
  const player = usePlayer()

  useEffect(() => {
    let active = true
    setLoading(true)
    getPublicShare(token)
      .then((payload) => {
        if (!active) return
        setShare(payload)
        const title = payload.track?.title || payload.playlist?.title
        if (title) document.title = `${title} — XEDOC Play`
      })
      .catch(() => active && setError('Ссылка не найдена или больше недоступна.'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [token])

  const tracks = useMemo<Track[]>(() => {
    if (share?.kind === 'track' && share.track) return [share.track]
    return share?.playlist?.tracks || []
  }, [share])
  const title = share?.track?.title || share?.playlist?.title || 'Музыка'
  const subtitle = share?.playlist?.subtitle || `${tracks.length} треков`
  const coverUrl = share?.track?.coverUrl || share?.playlist?.coverUrl
  const coverTone = share?.track?.coverTone || share?.playlist?.coverTone
  const startAtSeconds = requestedStartAtSeconds === null || !share?.track
    ? requestedStartAtSeconds
    : Math.min(requestedStartAtSeconds, Math.max(0, Math.floor(share.track.durationMs / 1000) - 1))

  useEffect(() => {
    if (share?.kind !== 'track' || startAtSeconds === null || !tracks.length) return
    player.playQueue(tracks, 0, undefined, startAtSeconds)
  }, [player.playQueue, share?.kind, startAtSeconds, tracks])

  const copyCurrentLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      // The current URL remains selectable from the browser when clipboard access is blocked.
    }
  }

  if (loading) return <main className="public-share-state"><LoaderCircle className="spin" size={28} /><span>Открываем музыку…</span></main>
  if (error || !share) return (
    <main className="public-share-state public-share-state--error">
      <span className="brand__mark">X</span><h1>Музыка недоступна</h1><p>{error}</p><a className="secondary-button" href="/"><ArrowLeft size={17} /> На главную</a>
    </main>
  )

  return (
    <div className="public-share-page">
      <header className="public-share-topbar">
        <a className="brand" href="/"><span className="brand__mark">X</span><span className="brand__word"><strong>XEDOC</strong><small>PLAY</small></span></a>
        <span><Headphones size={16} /> Публичное прослушивание</span>
        <a className="secondary-button" href="/">Открыть XEDOC Play</a>
      </header>
      <main className="public-share-main">
        <section className="public-share-hero">
          <CoverArt title={title} url={coverUrl} tone={coverTone} className="public-share-cover" />
          <div className="public-share-copy">
            <span className="eyebrow">{share.kind === 'track' ? 'ТРЕК ДЛЯ ВАС' : 'ПЛЕЙЛИСТ ДЛЯ ВАС'}</span>
            <h1>{title}</h1>
            <p>{share.track
              ? <><ArtistLinks artists={share.track.artists} className="public-share-artists" />{share.track.album && <> · {share.track.album}</>}</>
              : subtitle}</p>
            <small>Поделился {share.sharedBy}{share.kind === 'track' && startAtSeconds !== null ? ` · старт с ${formatTime(startAtSeconds)}` : ''}</small>
            <div>
              <button className="primary-button" type="button" disabled={!tracks.length} onClick={() => player.playQueue(tracks, 0, undefined, startAtSeconds ?? 0)}><Play size={18} fill="currentColor" /> {share.kind === 'track' && startAtSeconds !== null ? `Слушать с ${formatTime(startAtSeconds)}` : share.kind === 'track' ? 'Слушать трек' : 'Слушать всё'}</button>
              <button className="secondary-button" type="button" onClick={() => void copyCurrentLink()}><Share2 size={17} /> {copied ? 'Ссылка скопирована' : 'Поделиться'}</button>
            </div>
          </div>
        </section>
        {share.kind === 'playlist' && (
          <section className="public-share-tracks">
            <header><div><span className="eyebrow">ТРЕКЛИСТ</span><h2>{tracks.length} треков</h2></div><span>Без регистрации · прямо в браузере</span></header>
            <div className="track-table track-table--large">
              {tracks.map((track, index) => <TrackRow key={`${track.id}-${index}`} track={track} context={tracks} index={index} readonly />)}
            </div>
          </section>
        )}
        {share.kind === 'track' && share.track && (
          <section className="public-share-single">
            <TrackRow track={share.track} context={tracks} readonly />
          </section>
        )}
      </main>
      <PlayerBar readonly onQueue={() => undefined} />
    </div>
  )
}
