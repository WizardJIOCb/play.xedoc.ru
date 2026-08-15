import { ExternalLink, Globe2, Heart, LockKeyhole, Music2, Play, Trash2, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { deleteSocialPost, toggleSocialPostLike, voteSocialPoll } from '../lib/api'
import { usePlayer } from '../player/PlayerContext'
import type { SocialAttachment, SocialPost } from '../types'
import { CoverArt } from './CoverArt'

function timeLabel(timestamp: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp)
  if (seconds < 60) return 'только что'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} ч`
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(timestamp * 1000))
}

function Attachment({ attachment }: { attachment: SocialAttachment }) {
  const player = usePlayer()
  if (attachment.kind === 'image') return <img className="social-card__image" src={attachment.url} alt={attachment.title || ''} />
  if (attachment.kind === 'video') {
    const direct = /\.(mp4|webm|ogg)(\?.*)?$/i.test(attachment.url) || attachment.url.startsWith('data:video/')
    return direct
      ? <video className="social-card__video" src={attachment.url} controls preload="metadata" />
      : <a className="social-card__link" href={attachment.url} target="_blank" rel="noreferrer"><Play size={20} /><span><strong>{attachment.title || 'Открыть видео'}</strong><small>{attachment.url}</small></span><ExternalLink size={16} /></a>
  }
  if (attachment.kind === 'link') return <a className="social-card__link" href={attachment.url} target="_blank" rel="noreferrer">{attachment.imageUrl && <img src={attachment.imageUrl} alt="" />}<span><strong>{attachment.title || 'Открыть ссылку'}</strong><small>{attachment.description || attachment.url}</small></span><ExternalLink size={16} /></a>
  if (attachment.kind === 'track') return <button className="social-card__music" type="button" onClick={() => player.playTrack(attachment.track)}><CoverArt title={attachment.track.title} url={attachment.track.coverUrl} tone={attachment.track.coverTone} className="social-card__music-cover" /><span><small>ТРЕК</small><strong>{attachment.track.title}</strong><em>{attachment.track.artists.join(', ')}</em></span><Play size={19} fill="currentColor" /></button>
  return <button className="social-card__music" type="button" disabled={!attachment.playlist.tracks?.length} onClick={() => attachment.playlist.tracks?.length && player.playQueue(attachment.playlist.tracks)}><CoverArt title={attachment.playlist.title} url={attachment.playlist.coverUrl} tone={attachment.playlist.coverTone} className="social-card__music-cover" /><span><small>ПЛЕЙЛИСТ</small><strong>{attachment.playlist.title}</strong><em>{attachment.playlist.trackCount} треков</em></span><Music2 size={19} /></button>
}

function PostText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return <p className="social-card__text">{parts.map((part, index) => /^https?:\/\//.test(part) ? <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a> : part)}</p>
}

export function SocialPostCard({ post: initialPost, onDeleted, readonly = false }: { post: SocialPost; onDeleted?: (id: string) => void; readonly?: boolean }) {
  const [post, setPost] = useState(initialPost)
  const [busy, setBusy] = useState(false)
  const update = async (action: () => Promise<SocialPost>) => {
    setBusy(true)
    try { setPost(await action()) } finally { setBusy(false) }
  }
  return <article className="social-card">
    <header className="social-card__header">
      <a className="social-avatar" href={`/users/${encodeURIComponent(post.author.username)}`}>{post.author.displayName.trim().charAt(0).toUpperCase() || 'X'}</a>
      <span><a href={`/users/${encodeURIComponent(post.author.username)}`}><strong>{post.author.displayName}</strong></a><small>@{post.author.username} · {timeLabel(post.createdAt)}</small></span>
      <em title={post.visibility === 'friends' ? 'Только друзья' : 'Видно всем'}>{post.visibility === 'friends' ? <LockKeyhole size={14} /> : <Globe2 size={14} />}</em>
      {post.isOwner && <button className="icon-button" type="button" aria-label="Удалить запись" onClick={() => { if (window.confirm('Удалить эту запись?')) void deleteSocialPost(post.id).then(() => onDeleted?.(post.id)) }}><Trash2 size={15} /></button>}
    </header>
    {post.rankingReason && <div className="social-card__reason"><UsersRound size={13} /> {post.rankingReason}</div>}
    {post.body && <PostText text={post.body} />}
    {post.attachments.length > 0 && <div className="social-card__attachments">{post.attachments.map((attachment, index) => <Attachment key={`${attachment.kind}-${index}`} attachment={attachment} />)}</div>}
    {post.poll && <section className="social-poll"><strong>{post.poll.question}</strong>{post.poll.options.map((option) => {
      const percentage = post.poll!.totalVotes ? Math.round(option.votes / post.poll!.totalVotes * 100) : 0
      return <button key={option.id} className={option.selected ? 'is-selected' : ''} type="button" disabled={busy || readonly} onClick={() => void update(() => voteSocialPoll(post.id, option.id))}><span style={{ width: `${percentage}%` }} /><em>{option.text}</em><small>{percentage}%</small></button>
    })}<small>{post.poll.totalVotes.toLocaleString('ru-RU')} голосов</small></section>}
    <footer className="social-card__actions"><button className={post.liked ? 'is-active' : ''} type="button" disabled={busy || readonly} onClick={() => void update(() => toggleSocialPostLike(post.id, !post.liked))}><Heart size={18} fill={post.liked ? 'currentColor' : 'none'} /> {post.likeCount || ''}</button></footer>
  </article>
}
