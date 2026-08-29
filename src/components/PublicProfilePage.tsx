import { ArrowLeft, CalendarDays, Camera, Check, ChevronRight, Clock3, Disc3, Globe2, Headphones, History, Library, ListMusic, LoaderCircle, Pause, Pencil, Play, Radio, Save, UserMinus, UserPlus, UserRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { acceptFriend, getFriendStatus, getPublicListeningHistory, getPublicNowPlaying, getPublicProfile, getPublicProfilePlaylist, getSocialProfilePosts, removeFriend, requestFriend, updateAccountProfile } from '../lib/api'
import { usePlayer } from '../player/PlayerContext'
import type { AppUser, FriendStatus, Playlist, PublicListeningHistoryEntry, PublicNowPlaying, PublicProfile, SocialPost } from '../types'
import { ArtistLinks } from './ArtistLinks'
import { CoverArt } from './CoverArt'
import { PlayerBar } from './PlayerBar'
import { SocialPostCard } from './SocialPostCard'
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

function playedDate(timestamp: number) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp * 1000))
}

function ProfileAvatar({ profile }: { profile: Pick<PublicProfile, 'avatarUrl' | 'displayName'> }) {
  return <div className="public-profile-avatar">{profile.avatarUrl ? <img src={profile.avatarUrl} alt={`Аватар ${profile.displayName}`} /> : profile.displayName.trim().charAt(0).toUpperCase() || 'X'}</div>
}

interface PublicProfilePageProps {
  username: string
  embedded?: boolean
  viewer?: AppUser
  onBack?: () => void
  onProfileUpdated?: (user: AppUser) => void
}

export function PublicProfilePage({ username, embedded = false, viewer, onBack, onProfileUpdated }: PublicProfilePageProps) {
  const [profile, setProfile] = useState<PublicProfile>()
  const [nowPlaying, setNowPlaying] = useState<PublicNowPlaying>()
  const [historyItems, setHistoryItems] = useState<PublicListeningHistoryEntry[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [playlist, setPlaylist] = useState<Playlist>()
  const [loading, setLoading] = useState(true)
  const [playlistLoading, setPlaylistLoading] = useState(false)
  const [error, setError] = useState('')
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [friendStatus, setFriendStatus] = useState<FriendStatus>()
  const [editing, setEditing] = useState(false)
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [avatarDraft, setAvatarDraft] = useState<string>()
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)
  const player = usePlayer()

  useEffect(() => {
    let active = true
    setLoading(true)
    setProfile(undefined)
    setPlaylist(undefined)
    setHistoryItems([])
    setHistoryTotal(0)
    setHistoryError('')
    setError('')
    getPublicProfile(username)
      .then((value) => {
        if (!active) return
        setProfile(value)
        setNowPlaying(value.nowPlaying)
        document.title = `${value.displayName} (@${value.username}) — XEDOC Play`
      })
      .catch(() => active && setError('Такого профиля нет или он больше недоступен.'))
      .finally(() => active && setLoading(false))
    setHistoryLoading(true)
    void getPublicListeningHistory(username)
      .then((value) => {
        if (!active) return
        setHistoryItems(value.items)
        setHistoryTotal(value.total)
      })
      .catch(() => active && setHistoryError('Не удалось загрузить историю прослушиваний.'))
      .finally(() => active && setHistoryLoading(false))
    void getSocialProfilePosts(username).then((value) => active && setPosts(value)).catch(() => undefined)
    void getFriendStatus(username).then((value) => active && setFriendStatus(value)).catch(() => undefined)
    return () => { active = false; document.title = 'XEDOC Play' }
  }, [username])

  useEffect(() => {
    if (!profile) return
    let active = true
    const interval = window.setInterval(() => {
      void getPublicNowPlaying(profile.username).then((value) => active && setNowPlaying(value || undefined)).catch(() => undefined)
    }, 15_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [profile])

  const loadMoreHistory = async () => {
    if (historyLoading || historyItems.length >= historyTotal) return
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const value = await getPublicListeningHistory(username, historyItems.length, 6)
      setHistoryItems((items) => {
        const known = new Set(items.map((item) => item.eventId))
        return [...items, ...value.items.filter((item) => !known.has(item.eventId))]
      })
      setHistoryTotal(value.total)
    } catch {
      setHistoryError('Не удалось загрузить следующие треки.')
    } finally {
      setHistoryLoading(false)
    }
  }

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

  const changeFriendStatus = async () => {
    if (!friendStatus || friendStatus === 'self') return
    if (friendStatus === 'none') setFriendStatus(await requestFriend(username))
    else if (friendStatus === 'incoming') setFriendStatus(await acceptFriend(username))
    else { await removeFriend(username); setFriendStatus('none') }
  }

  const startEditing = () => {
    if (!profile) return
    setDisplayNameDraft(profile.displayName)
    setAvatarDraft(undefined)
    setEditError('')
    setEditing(true)
  }

  const selectAvatar = async (file?: File) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setEditError('Поддерживаются изображения JPEG, PNG и WebP.')
      return
    }
    if (file.size > 1_200_000) {
      setEditError('Аватар должен быть не больше 1,2 МБ.')
      return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error())
      reader.onerror = () => reject(reader.error || new Error())
      reader.readAsDataURL(file)
    }).catch(() => '')
    if (!dataUrl) {
      setEditError('Не удалось прочитать выбранное изображение.')
      return
    }
    setAvatarDraft(dataUrl)
    setEditError('')
  }

  const saveProfile = async () => {
    if (!profile) return
    const displayName = displayNameDraft.trim()
    if (!displayName) {
      setEditError('Введите имя профиля.')
      return
    }
    setSaving(true)
    setEditError('')
    try {
      const updated = await updateAccountProfile(displayName, avatarDraft)
      setProfile((value) => value ? { ...value, displayName: updated.displayName, avatarUrl: updated.avatarUrl } : value)
      setPosts((items) => items.map((post) => post.author.username.toLowerCase() === updated.username.toLowerCase() ? { ...post, author: { ...post.author, displayName: updated.displayName } } : post))
      onProfileUpdated?.(updated)
      setEditing(false)
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : 'Не удалось сохранить профиль.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <main className={`public-share-state ${embedded ? 'public-share-state--embedded' : ''}`}><LoaderCircle className="spin" size={28} /><span>Открываем профиль…</span></main>
  if (!profile) return (
    <main className={`public-share-state public-share-state--error ${embedded ? 'public-share-state--embedded' : ''}`}>
      <span className="brand__mark">X</span><h1>Профиль не найден</h1><p>{error}</p>
      {onBack ? <button className="secondary-button" type="button" onClick={onBack}><ArrowLeft size={17} /> На главную</button> : <a className="secondary-button" href="/"><ArrowLeft size={17} /> На главную</a>}
    </main>
  )

  const canEdit = viewer?.username.toLowerCase() === profile.username.toLowerCase()
  const body = <>
    {playlist ? <>
      <button className="public-profile-back" type="button" onClick={() => setPlaylist(undefined)}><ArrowLeft size={17} /> Профиль @{profile.username}</button>
      <section className="public-profile-playlist-hero">
        <CoverArt title={playlist.title} url={playlist.coverUrl} tone={playlist.coverTone} className="public-profile-playlist-cover" />
        <div><span className="eyebrow"><Globe2 size={14} /> ПУБЛИЧНЫЙ ПЛЕЙЛИСТ</span><h1>{playlist.title}</h1><p>{playlist.description || playlist.subtitle}</p><button className="primary-button" type="button" disabled={!playlist.tracks?.length} onClick={() => player.playQueue(playlist.tracks || [])}><Play size={18} fill="currentColor" /> Слушать всё</button></div>
      </section>
      <section className="public-profile-tracklist">
        <header><h2>{playlist.tracks?.length || 0} треков</h2><span>Можно слушать без регистрации</span></header>
        <div className="track-table track-table--large">{playlist.tracks?.map((track, index) => <TrackRow key={`${track.id}-${index}`} track={track} context={playlist.tracks || []} index={index} readonly />)}</div>
      </section>
    </> : <>
      <section className="public-profile-hero">
        <ProfileAvatar profile={profile} />
        <div className="public-profile-identity">
          <span className="eyebrow">ПРОФИЛЬ XEDOC</span><h1>{profile.displayName}</h1><p>@{profile.username}</p>
          <small><CalendarDays size={14} /> В XEDOC с {memberDate(profile.memberSince)}</small>
          {canEdit && <button className="secondary-button public-profile-edit-button" type="button" onClick={startEditing}><Pencil size={16} /> Изменить профиль</button>}
          {friendStatus && friendStatus !== 'self' && <button className="secondary-button public-profile-friend" type="button" onClick={() => void changeFriendStatus()}>{friendStatus === 'none' ? <><UserPlus size={16} /> Добавить в друзья</> : friendStatus === 'incoming' ? <><Check size={16} /> Принять заявку</> : friendStatus === 'outgoing' ? <><UserMinus size={16} /> Заявка отправлена</> : <><UserMinus size={16} /> В друзьях</>}</button>}
        </div>
      </section>

      <section className="public-profile-activity" aria-label="Музыкальная активность">
        {nowPlaying && <div className="public-profile-now-playing" role="group" aria-label="Слушает сейчас">
          <CoverArt title={nowPlaying.track.title} url={nowPlaying.track.coverUrl} tone={nowPlaying.track.coverTone} className="public-profile-now-playing__cover" />
          <div className="public-profile-now-playing__track">
            <div className="public-profile-now-playing__live"><span /><Radio size={15} /> СЛУШАЕТ СЕЙЧАС</div>
            <strong>{nowPlaying.track.title}</strong>
            <ArtistLinks artists={nowPlaying.track.artists} />
          </div>
          {nowPlaying.playlist && <button className="public-profile-now-playing__playlist" type="button" onClick={() => void openPlaylist(nowPlaying.playlist!)}><ListMusic size={17} /><span><small>ИЗ ПЛЕЙЛИСТА</small><strong>{nowPlaying.playlist.title}</strong></span><ChevronRight size={16} /></button>}
        </div>}

        <div className="public-profile-history">
          <header><div><span className="eyebrow"><History size={14} /> НЕДАВНО В НАУШНИКАХ</span><h2>История прослушиваний</h2></div>{historyTotal > 0 && <small>{historyTotal.toLocaleString('ru-RU')} всего</small>}</header>
          {historyItems.length > 0 && <div className="public-profile-history__list">{historyItems.map((item) => <article key={item.eventId}>
            <CoverArt title={item.track.title} url={item.track.coverUrl} tone={item.track.coverTone} className="public-profile-history__cover" />
            <div><strong>{item.track.title}</strong><ArtistLinks artists={item.track.artists} /></div>
            <time dateTime={new Date(item.playedAt * 1000).toISOString()}><Clock3 size={13} /> {playedDate(item.playedAt)}</time>
          </article>)}</div>}
          {!historyItems.length && historyLoading && <div className="public-profile-history__state"><LoaderCircle className="spin" size={18} /> Загружаем последние треки…</div>}
          {!historyItems.length && !historyLoading && !historyError && <div className="public-profile-history__state"><History size={18} /> История пока пустая</div>}
          {historyError && <div className="public-profile-history__error">{historyError}</div>}
          {historyItems.length < historyTotal && <button className="secondary-button public-profile-history__more" type="button" disabled={historyLoading} onClick={() => void loadMoreHistory()}>{historyLoading ? <LoaderCircle className="spin" size={16} /> : <History size={16} />} Загрузить ещё</button>}
        </div>
      </section>

      <section className="public-profile-stats" aria-label="Статистика профиля">
        <article><Headphones size={20} /><span><strong>{profile.stats.totalPlays.toLocaleString('ru-RU')}</strong><small>прослушиваний</small></span></article>
        <article><Disc3 size={20} /><span><strong>{profile.stats.uniqueTracks.toLocaleString('ru-RU')}</strong><small>разных треков</small></span></article>
        <article><Clock3 size={20} /><span><strong>{listeningTime(profile.stats.totalListenedMs)}</strong><small>в музыке</small></span></article>
        <article><Library size={20} /><span><strong>{profile.publicPlaylistCount}</strong><small>публичных плейлистов</small></span></article>
      </section>

      <section className="public-profile-section public-profile-wall">
        <header><div><span className="eyebrow">ЗАПИСИ</span><h2>Стена</h2></div></header>
        {posts.length ? <div className="social-feed-list">{posts.map((post) => <SocialPostCard key={post.id} post={post} readonly={!friendStatus} />)}</div> : <div className="public-profile-empty"><Globe2 size={25} /><strong>Пока нет записей</strong><span>Здесь появятся посты, музыка, видео и опросы пользователя.</span></div>}
      </section>

      <section className="public-profile-section">
        <header><div><span className="eyebrow"><Globe2 size={14} /> ОТКРЫТАЯ КОЛЛЕКЦИЯ</span><h2>Публичные плейлисты</h2></div></header>
        {profile.playlists.length ? <div className="public-profile-playlists">{profile.playlists.map((item) => <button key={item.id} type="button" onClick={() => void openPlaylist(item)}><CoverArt title={item.title} url={item.coverUrl} tone={item.coverTone} className="public-profile-playlist-card-cover" /><span><strong>{item.title}</strong><small>{item.trackCount} треков{item.durationMinutes ? ` · ${item.durationMinutes} мин` : ''}</small></span><Play size={18} fill="currentColor" /></button>)}</div> : <div className="public-profile-empty"><Globe2 size={25} /><strong>Пока нет публичных плейлистов</strong><span>Приватные плейлисты этого пользователя остаются скрыты.</span></div>}
      </section>

      {profile.topTracks.length > 0 && <section className="public-profile-section public-profile-top">
        <header><div><span className="eyebrow">СТАТИСТИКА ВКУСА</span><h2>Часто слушает</h2></div><small>Без раскрытия полной истории</small></header>
        <div>{profile.topTracks.map((track, index) => {
          const active = player.current?.id === track.id
          return <article key={track.id} className={active ? 'is-active' : ''}><button className="public-profile-top__play" type="button" aria-label={active && player.isPlaying ? `Пауза ${track.title}` : `Включить ${track.title}`} onClick={() => active ? player.togglePlayback() : player.playTrack(track, profile.topTracks, index)}>{active && player.isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><CoverArt title={track.title} url={track.coverUrl} tone={track.coverTone} className="public-profile-top-cover" /><span><strong>{track.title}</strong><ArtistLinks artists={track.artists} /></span><em>{track.playCount || 0} просл.</em></article>
        })}</div>
      </section>}
    </>}
    {playlistLoading && <div className="public-profile-loading"><LoaderCircle className="spin" size={22} /> Загружаем плейлист…</div>}
    {error && <div className="form-error public-profile-error">{error}</div>}
    {editing && <div className="profile-edit-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditing(false) }}>
      <form className="profile-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title" onSubmit={(event) => { event.preventDefault(); void saveProfile() }}>
        <header><div><span className="eyebrow">ВАШ ПРОФИЛЬ</span><h2 id="profile-edit-title">Имя и аватар</h2></div><button className="icon-button" type="button" aria-label="Закрыть" disabled={saving} onClick={() => setEditing(false)}><X size={18} /></button></header>
        <div className="profile-edit-avatar"><div className="public-profile-avatar">{avatarDraft || profile.avatarUrl ? <img src={avatarDraft || profile.avatarUrl} alt="Предпросмотр аватара" /> : profile.displayName.trim().charAt(0).toUpperCase() || 'X'}</div><label className="secondary-button"><Camera size={17} /><span>{avatarDraft || profile.avatarUrl ? 'Выбрать другую' : 'Загрузить аватар'}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectAvatar(event.target.files?.[0])} /></label><small>JPEG, PNG или WebP, до 1,2 МБ</small></div>
        <label className="profile-edit-name"><span>Отображаемое имя</span><input autoFocus value={displayNameDraft} maxLength={80} onChange={(event) => setDisplayNameDraft(event.target.value)} /></label>
        {editError && <div className="form-error">{editError}</div>}
        <footer><button className="secondary-button" type="button" disabled={saving} onClick={() => setEditing(false)}>Отмена</button><button className="primary-button" type="submit" disabled={saving || !displayNameDraft.trim()}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Сохранить</button></footer>
      </form>
    </div>}
  </>

  if (embedded) return <div className="public-profile-main public-profile-main--embedded">{body}</div>
  return <div className="public-profile-page"><header className="public-share-topbar"><a className="brand" href="/"><span className="brand__mark">X</span><span className="brand__word"><strong>XEDOC</strong><small>PLAY</small></span></a><span><UserRound size={16} /> Публичный профиль</span><a className="secondary-button" href="/">Открыть XEDOC Play</a></header><main className="public-profile-main">{body}</main><PlayerBar readonly onQueue={() => undefined} /></div>
}
