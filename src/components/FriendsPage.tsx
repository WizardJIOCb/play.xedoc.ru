import { Check, LoaderCircle, Search, UserMinus, UserPlus, UsersRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { acceptFriend, getFriends, removeFriend, requestFriend, searchProfiles } from '../lib/api'
import type { Friend, FriendsPayload, ProfileSummary } from '../types'

function Person({ person, action, actionLabel, icon: Icon }: { person: Friend | ProfileSummary; action: () => void; actionLabel: string; icon: typeof UserPlus }) {
  return <article className="friend-row"><a className="social-avatar" href={`/users/${encodeURIComponent(person.username)}`}>{person.displayName.charAt(0).toUpperCase()}</a><a href={`/users/${encodeURIComponent(person.username)}`}><strong>{person.displayName}</strong><small>@{person.username}</small></a><button className="secondary-button" type="button" onClick={action}><Icon size={16} /> {actionLabel}</button></article>
}

export function FriendsPage({ username }: { username?: string }) {
  const [data, setData] = useState<FriendsPayload>({ friends: [], incoming: [], outgoing: [] })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProfileSummary[]>([])
  const [loading, setLoading] = useState(true)
  const load = () => { setLoading(true); void getFriends().then(setData).finally(() => setLoading(false)) }
  useEffect(load, [])
  useEffect(() => {
    const timer = window.setTimeout(() => { if (query.trim().length >= 2) void searchProfiles(query).then((items) => setResults(items.filter((item) => item.username !== username))); else setResults([]) }, 250)
    return () => window.clearTimeout(timer)
  }, [query, username])
  const mutate = async (action: () => Promise<unknown>) => { await action(); load(); setResults([]); setQuery('') }
  return <div className="friends-page">
    <section className="friends-search"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти человека по имени или @username" /></section>
    {results.length > 0 && <section className="friends-section"><h2>Люди</h2>{results.map((person) => <Person key={person.username} person={person} action={() => void mutate(() => requestFriend(person.username))} actionLabel="Добавить" icon={UserPlus} />)}</section>}
    {loading ? <div className="social-feed-state"><LoaderCircle className="spin" size={24} /></div> : <>
      {data.incoming.length > 0 && <section className="friends-section"><h2>Заявки в друзья <span>{data.incoming.length}</span></h2>{data.incoming.map((person) => <Person key={person.username} person={person} action={() => void mutate(() => acceptFriend(person.username))} actionLabel="Принять" icon={Check} />)}</section>}
      <section className="friends-section"><h2>Друзья <span>{data.friends.length}</span></h2>{data.friends.length ? data.friends.map((person) => <Person key={person.username} person={person} action={() => void mutate(() => removeFriend(person.username))} actionLabel="Удалить" icon={UserMinus} />) : <div className="friends-empty"><UsersRound size={28} /><strong>Здесь появятся друзья</strong><span>Найдите знакомых или людей с похожим музыкальным вкусом.</span></div>}</section>
      {data.outgoing.length > 0 && <section className="friends-section"><h2>Отправленные заявки</h2>{data.outgoing.map((person) => <Person key={person.username} person={person} action={() => void mutate(() => removeFriend(person.username))} actionLabel="Отменить" icon={X} />)}</section>}
    </>}
  </div>
}
