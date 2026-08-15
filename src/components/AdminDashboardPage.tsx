import { Activity, Clock3, Disc3, ExternalLink, Globe2, Headphones, Library, Link2, LoaderCircle, Search, ShieldCheck, UserRound, UsersRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getAdminDashboard } from '../lib/api'
import type { AdminDashboard } from '../types'
import { CoverArt } from './CoverArt'
import { ArtistLinks } from './ArtistLinks'

function listeningTime(milliseconds: number) {
  const hours = milliseconds / 3_600_000
  if (hours >= 1) return `${Math.round(hours).toLocaleString('ru-RU')} ч`
  return `${Math.round(milliseconds / 60_000).toLocaleString('ru-RU')} мин`
}

function dateTime(timestamp?: number) {
  if (!timestamp) return 'ещё не слушал'
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp * 1000))
}

function registrationDate(timestamp: number) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(timestamp * 1000))
}

function registrationTime(timestamp: number) {
  return new Intl.DateTimeFormat('ru-RU', { timeStyle: 'short' }).format(new Date(timestamp * 1000))
}

export function AdminDashboardPage({ isAdmin }: { isAdmin: boolean }) {
  const [dashboard, setDashboard] = useState<AdminDashboard>()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(isAdmin)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAdmin) return
    let active = true
    setLoading(true)
    setError('')
    const timeout = window.setTimeout(() => {
      void getAdminDashboard(query)
        .then((value) => active && setDashboard(value))
        .catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Не удалось загрузить админку'))
        .finally(() => active && setLoading(false))
    }, query ? 260 : 0)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [isAdmin, query])

  if (!isAdmin) return <section className="admin-denied"><ShieldCheck size={34} /><h1>Раздел только для администратора</h1><p>Сервер проверяет права для каждого запроса. Войдите под административным аккаунтом.</p></section>
  if (!dashboard && loading) return <section className="admin-state"><LoaderCircle className="spin" size={26} /> Загружаем данные сервиса…</section>
  if (!dashboard) return <section className="admin-denied"><ShieldCheck size={34} /><h1>Админка недоступна</h1><p>{error}</p></section>

  const summary = dashboard.summary
  const metrics = [
    [UsersRound, summary.usersTotal, 'пользователей', `+${summary.newUsers7d} за 7 дней`],
    [Activity, summary.activeUsers30d, 'активных за 30 дней', 'по прослушиваниям'],
    [Headphones, summary.yandexConnected, 'подключили Яндекс', `${summary.usersTotal ? Math.round(summary.yandexConnected / summary.usersTotal * 100) : 0}% аккаунтов`],
    [Library, summary.playlistsTotal, 'плейлистов XEDOC', `${summary.publicPlaylists} публичных`],
    [Disc3, summary.playlistTracks, 'треков в плейлистах', `${summary.uniqueTracks} слушали`],
    [Clock3, listeningTime(summary.totalListenedMs), 'времени в музыке', `${summary.totalPlays} прослушиваний`],
    [Link2, summary.publicShares, 'публичных ссылок', 'треки и плейлисты'],
  ] as const

  return (
    <section className="admin-page">
      <header className="admin-page__hero">
        <div><span className="eyebrow"><ShieldCheck size={15} /> XEDOC CONTROL</span><h1>Админка сервиса</h1><p>Пользователи, музыкальная активность и состояние коллекции — без доступа к паролям и токенам.</p></div>
        <span className="admin-page__live"><i /> Сервис работает</span>
      </header>

      <div className="admin-metrics">{metrics.map(([Icon, value, label, detail]) => <article key={label}><Icon size={20} /><span><strong>{typeof value === 'number' ? value.toLocaleString('ru-RU') : value}</strong><b>{label}</b><small>{detail}</small></span></article>)}</div>

      <section className="admin-users">
        <header><div><span className="eyebrow">АККАУНТЫ</span><h2>Пользователи</h2></div><label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или @логин" />{loading && <LoaderCircle className="spin" size={16} />}</label></header>
        <div className="admin-users__table">
          <div className="admin-users__head"><span>Профиль</span><span>Регистрация</span><span>Музыка</span><span>Плейлисты</span><span>Активность</span><span /></div>
          {dashboard.users.map((user) => <article key={user.username}>
            <div className="admin-user-identity"><span>{user.displayName.charAt(0).toUpperCase() || 'X'}</span><p><strong>{user.displayName}</strong><small>@{user.username}{user.isAdmin && <em><ShieldCheck size={11} /> admin</em>}</small></p></div>
            <div className="admin-user-created" aria-label={`Дата регистрации ${user.displayName}`}><strong>{registrationDate(user.createdAt)}</strong><small>{registrationTime(user.createdAt)}</small></div>
            <div className="admin-user-source"><i className={user.yandexConnected ? 'is-connected' : ''} /> <span>{user.yandexConnected ? 'Яндекс подключён' : 'Без подключения'}</span></div>
            <div><strong>{user.playlists}</strong><small>{user.publicPlaylists} публичных · {user.playlistTracks} треков</small></div>
            <div><strong>{user.totalPlays} просл.</strong><small>{user.uniqueTracks} треков · {listeningTime(user.totalListenedMs)}<br />{dateTime(user.lastPlayedAt)}</small></div>
            <a href={`/users/${encodeURIComponent(user.username)}`} aria-label={`Открыть профиль ${user.displayName}`} data-tooltip="Открыть публичный профиль"><ExternalLink size={17} /></a>
          </article>)}
          {!dashboard.users.length && <div className="admin-users__empty"><UserRound size={23} /> Пользователи не найдены</div>}
        </div>
      </section>

      <section className="admin-top-tracks">
        <header><div><span className="eyebrow"><Globe2 size={14} /> ПО ВСЕМУ СЕРВИСУ</span><h2>Самые прослушиваемые треки</h2></div><small>Суммарно по аккаунтам</small></header>
        <div>{dashboard.topTracks.map((track, index) => <article key={track.id}><span>{index + 1}</span><CoverArt title={track.title} url={track.coverUrl} tone={track.coverTone} className="admin-top-track-cover" /><p><strong>{track.title}</strong><ArtistLinks artists={track.artists} /></p><em>{track.playCount || 0} просл.</em></article>)}</div>
      </section>
    </section>
  )
}
