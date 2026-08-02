import { ArrowLeft, CalendarDays, ChevronRight, Clock3, Disc3, Globe2, Headphones, Library, ListMusic, LoaderCircle, Play, Radio, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getPublicNowPlaying, getPublicProfile, getPublicProfilePlaylist } from '../lib/api'
import { usePlayer } from '../player/PlayerContext'
import type { Playlist, PublicNowPlaying, PublicProfile } from '../types'
import { CoverArt } from './CoverArt'
import { ArtistLinks } from './ArtistLinks'
import { PlayerBar } from './PlayerBar'
import { TrackRow } from './TrackRow'

function listeningTime(milliseconds: number) {
  if (!milliseconds) return '0 мин'
  const minutes = Math.max(1, Math.round(milliseconds / 60_000))
  if (minutes < 60) return `${minutes} мин`
  return `${Math.round(minutes / 60)} ч`
}

function memberDate(timestamp: number) {
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(timestamp * 1000))
}

export function PublicProfilePage({ username }: { username: string }) {
  const [profile, setProfile] = useState<PublicProfile>()
  const [nowPlaying, setNowPlaying] = useState<PublicNowPlaying>()
  const [playlist, setPlaylist] = useState<Playlist>()
  const [loading, setLoading] = useState(true)
  const [playlistLoading, setPlaylistLoading] = useState(false)
  const [error, setError] = useState('')
  const player = usePlayer()

  useEffect(() => {
    let active = true
    setLoading(true)
    getPublicProfile(username)
      .then((value) => {
        if (!active) return
        setProfile(value)
        setNowPlaying(value.nowPlaying)
        document.title = `${value.displayName} (@${value.username}) — XEDOC Play`
      })
      .catch(() => active && setError('Такого профиля нет или он больше недоступен.'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [username])

  useEffect(() => {
    if (!profile) return
    let active = true
    const interval = window.setInterval(() => {
      void getPublicNowPlaying(profile.username)
        .then((value) => active && setNowPlaying(value || undefined))
        .catch(() => undefined)
    }, 15_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [profile])

  const openPlaylist = async (value: Playlist) => {
    if (!profile) return
    setPlaylistLoading(true)
    setError('')
    try {
      setPlaylist(await getPublicProfilePlaylist(profile.username, value.id))
    } catch {
      setError('Не удалось открыть этот плейлист. Возможно, владелец сделал его приватным.')
    } finally {
      setPlaylistLoading(false)
    }
  }

  if (loading) return <main className="public-share-state"><LoaderCircle className="spin" size={28} /><span>Открываем профиль…</span></main>
  if (!profile) return (
    <main className="public-share-state public-share-state--error">
      <span className="brand__mark">X</span><h1>Профиль не найден</h1><p>{error}</p><a className="secondary-button" href="/"><ArrowLeft size={17} /> На главную</a>
    </main>
  )

  return (
    <div className="public-profile-page">
      <header className="public-share-topbar">
        <a className="brand" href="/"><span className="brand__mark">X</span><span className="brand__word"><strong>XEDOC</strong><small>PLAY</small></span></a>
        <span><UserRound size={16} /> Публичный профиль</span>
        <a className="secondary-button" href="/">Открыть XEDOC Play</a>
      </header>

      <main className="public-profile-main">
        {playlist ? (
          <>
            <button className="public-profile-back" type="button" onClick={() => setPlaylist(undefined)}><ArrowLeft size={17} /> Профиль @{profile.username}</button>
            <section className="public-profile-playlist-hero">
              <CoverArt title={playlist.title} url={playlist.coverUrl} tone={playlist.coverTone} className="public-profile-playlist-cover" />
              <div><span className="eyebrow"><Globe2 size={14} /> ПУБЛИЧНЫЙ ПЛЕЙЛИСТ</span><h1>{playlist.title}</h1><p>{playlist.description || playlist.subtitle}</p><button className="primary-button" type="button" disabled={!playlist.tracks?.length} onClick={() => player.playQueue(playlist.tracks || [])}><Play size={18} fill="currentColor" /> Слушать всё</button></div>
            </section>
            <section className="public-profile-tracklist">
              <header><h2>{playlist.tracks?.length || 0} треков</h2><span>Можно слушать без регистрации</span></header>
              <div className="track-table track-table--large">{playlist.tracks?.map((track, index) => <TrackRow key={`${track.id}-${index}`} track={track} context={playlist.tracks || []} index={index} readonly />)}</div>
            </section>
          </>
        ) : (
          <>
            <section className="public-profile-hero">
              <div className="public-profile-avatar">{profile.displayName.trim().charAt(0).toUpperCase() || 'X'}</div>
              <div className="public-profile-identity"><span className="eyebrow">ПРОФИЛЬ XEDOC</span><h1>{profile.displayName}</h1><p>@{profile.username}</p><small><CalendarDays size={14} /> В XEDOC с {memberDate(profile.memberSince)}</small></div>
            </section>

            {nowPlaying && <section className="public-profile-now-playing" aria-label="Слушает сейчас">
              <div className="public-profile-now-playing__live"><span /><Radio size={16} /> СЛУШАЕТ СЕЙЧАС</div>
              <CoverArt title={nowPlaying.track.title} url={nowPlaying.track.coverUrl} tone={nowPlaying.track.coverTone} className="public-profile-now-playing__cover" />
              <div className="public-profile-now-playing__track" role="button" tabIndex={0} aria-label={`Включить ${nowPlaying.track.title}`} onClick={() => player.playTrack(nowPlaying.track)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); player.playTrack(nowPlaying.track) } }}>
                <span><strong>{nowPlaying.track.title}</strong><ArtistLinks artists={nowPlaying.track.artists} /></span>
                <span className="public-profile-now-playing__play"><Play size={19} fill="currentColor" /></span>
              </div>
              {nowPlaying.playlist && <button className="public-profile-now-playing__playlist" type="button" onClick={() => void openPlaylist(nowPlaying.playlist!)}>
                <ListMusic size={17} /><span><small>ИЗ ПЛЕЙЛИСТА</small><strong>{nowPlaying.playlist.title}</strong></span><ChevronRight size={16} />
              </button>}
            </section>}

            <section className="public-profile-stats" aria-label="Статистика профиля">
              <article><Headphones size={20} /><span><strong>{profile.stats.totalPlays.toLocaleString('ru-RU')}</strong><small>прослушиваний</small></span></article>
              <article><Disc3 size={20} /><span><strong>{profile.stats.uniqueTracks.toLocaleString('ru-RU')}</strong><small>разных треков</small></span></article>
              <article><Clock3 size={20} /><span><strong>{listeningTime(profile.stats.totalListenedMs)}</strong><small>в музыке</small></span></article>
              <article><Library size={20} /><span><strong>{profile.publicPlaylistCount}</strong><small>публичных плейлистов</small></span></article>
            </section>

            <section className="public-profile-section">
              <header><div><span className="eyebrow"><Globe2 size={14} /> ОТКРЫТАЯ КОЛЛЕКЦИЯ</span><h2>Публичные плейлисты</h2></div></header>
              {profile.playlists.length ? <div className="public-profile-playlists">{profile.playlists.map((item) => (
                <button key={item.id} type="button" onClick={() => void openPlaylist(item)}>
                  <CoverArt title={item.title} url={item.coverUrl} tone={item.coverTone} className="public-profile-playlist-card-cover" />
                  <span><strong>{item.title}</strong><small>{item.trackCount} треков{item.durationMinutes ? ` · ${item.durationMinutes} мин` : ''}</small></span>
                  <Play size={18} fill="currentColor" />
                </button>
              ))}</div> : <div className="public-profile-empty"><Globe2 size={25} /><strong>Пока нет публичных плейлистов</strong><span>Приватные плейлисты этого пользователя остаются скрыты.</span></div>}
            </section>

            {profile.topTracks.length > 0 && <section className="public-profile-section public-profile-top">
              <header><div><span className="eyebrow">СТАТИСТИКА ВКУСА</span><h2>Часто слушает</h2></div><small>Без раскрытия полной истории</small></header>
              <div>{profile.topTracks.map((track, index) => <article key={track.id}><span>{index + 1}</span><CoverArt title={track.title} url={track.coverUrl} tone={track.coverTone} className="public-profile-top-cover" /><span><strong>{track.title}</strong><ArtistLinks artists={track.artists} /></span><em>{track.playCount || 0} просл.</em></article>)}</div>
            </section>}
          </>
        )}
        {playlistLoading && <div className="public-profile-loading"><LoaderCircle className="spin" size={22} /> Загружаем плейлист…</div>}
        {error && <div className="form-error public-profile-error">{error}</div>}
      </main>
      <PlayerBar readonly onQueue={() => undefined} />
    </div>
  )
}
