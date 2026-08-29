import { ChevronDown, ChevronUp, ExternalLink, Globe2, Heart, LoaderCircle, LockKeyhole, MessageCircle, Music2, Pause, Play, Reply, Send, Trash2, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { createSocialComment, deleteSocialComment, deleteSocialPost, getSocialComments, toggleSocialPostLike, voteSocialPoll } from '../lib/api'
import { usePlayer } from '../player/PlayerContext'
import type { SocialAttachment, SocialComment, SocialPost } from '../types'
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
  if (attachment.kind === 'track') {
    const active = player.current?.id === attachment.track.id
    const playing = active && player.isPlaying
    return <button className="social-card__music" type="button" aria-label={`${playing ? 'Пауза' : 'Включить'} ${attachment.track.title}`} onClick={() => active ? player.togglePlayback() : player.playTrack(attachment.track)}><CoverArt title={attachment.track.title} url={attachment.track.coverUrl} tone={attachment.track.coverTone} className="social-card__music-cover" /><span><small>ТРЕК</small><strong>{attachment.track.title}</strong><em>{attachment.track.artists.join(', ')}</em></span>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
  }
  return <button className="social-card__music" type="button" disabled={!attachment.playlist.tracks?.length} onClick={() => attachment.playlist.tracks?.length && player.playQueue(attachment.playlist.tracks)}><CoverArt title={attachment.playlist.title} url={attachment.playlist.coverUrl} tone={attachment.playlist.coverTone} className="social-card__music-cover" /><span><small>ПЛЕЙЛИСТ</small><strong>{attachment.playlist.title}</strong><em>{attachment.playlist.trackCount} треков</em></span><Music2 size={19} /></button>
}

function PostText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return <p className="social-card__text">{parts.map((part, index) => /^https?:\/\//.test(part) ? <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a> : part)}</p>
}

function countComments(comments: SocialComment[]): number {
  return comments.reduce((total, comment) => total + (comment.deleted ? 0 : 1) + countComments(comment.replies), 0)
}

function CommentComposer({ postId, parentId, placeholder, onSent, onCancel }: { postId: string; parentId?: string; placeholder: string; onSent: () => void; onCancel?: () => void }) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const send = async () => {
    if (!body.trim()) return
    setSending(true); setError('')
    try { await createSocialComment(postId, body.trim(), parentId); setBody(''); onSent() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось отправить комментарий.') }
    finally { setSending(false) }
  }
  return <div className="comment-composer"><textarea autoFocus={Boolean(parentId)} value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} placeholder={placeholder} /><span>{onCancel && <button type="button" onClick={onCancel}>Отмена</button>}<button className="comment-composer__send" type="button" disabled={sending || !body.trim()} onClick={() => void send()}>{sending ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} Отправить</button></span>{error && <small className="form-error">{error}</small>}</div>
}

function CommentNode({ comment, postId, readonly, onChanged }: { comment: SocialComment; postId: string; readonly: boolean; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const canDelete = comment.isOwner && !comment.deleted && !readonly
  return <div className={`comment-node ${comment.deleted ? 'is-deleted' : ''}`}>
    <div className="comment-node__line"><a className="comment-avatar" href={`/users/${encodeURIComponent(comment.author.username)}`}>{comment.author.displayName.charAt(0).toUpperCase() || 'X'}</a><div className="comment-node__content"><header><a href={`/users/${encodeURIComponent(comment.author.username)}`}><strong>{comment.author.displayName}</strong></a><small>@{comment.author.username} · {timeLabel(comment.createdAt)}</small></header><p>{comment.body}</p>{!comment.deleted && <footer>{!readonly && <button type="button" onClick={() => setReplyOpen((value) => !value)}><Reply size={14} /> Ответить</button>}{canDelete && <button type="button" onClick={() => { if (window.confirm('Удалить комментарий?')) void deleteSocialComment(comment.id).then(onChanged) }}><Trash2 size={13} /> Удалить</button>}</footer>}</div></div>
    {replyOpen && <CommentComposer postId={postId} parentId={comment.id} placeholder={`Ответить @${comment.author.username}`} onCancel={() => setReplyOpen(false)} onSent={() => { setReplyOpen(false); setExpanded(true); onChanged() }} />}
    {comment.replies.length > 0 && <div className="comment-node__branch"><button className="comment-branch-toggle" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}{expanded ? 'Скрыть ветку' : `Показать ответы · ${comment.replies.length}`}</button>{expanded && <div className="comment-node__children">{comment.replies.map((reply) => <CommentNode key={reply.id} comment={reply} postId={postId} readonly={readonly} onChanged={onChanged} />)}</div>}</div>}
  </div>
}

export function SocialPostCard({ post: initialPost, onDeleted, readonly = false }: { post: SocialPost; onDeleted?: (id: string) => void; readonly?: boolean }) {
  const [post, setPost] = useState(initialPost)
  const [busy, setBusy] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState<SocialComment[]>()
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState('')
  const update = async (action: () => Promise<SocialPost>) => {
    setBusy(true)
    try { setPost(await action()) } finally { setBusy(false) }
  }
  const refreshComments = async () => {
    setCommentsLoading(true); setCommentsError('')
    try { const value = await getSocialComments(post.id); setComments(value); setPost((current) => ({ ...current, commentCount: countComments(value) })) }
    catch { setCommentsError('Не удалось загрузить комментарии.') }
    finally { setCommentsLoading(false) }
  }
  const toggleComments = () => {
    setCommentsOpen((value) => !value)
    if (!comments) void refreshComments()
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
    <footer className="social-card__actions"><button className={post.liked ? 'is-active' : ''} type="button" disabled={busy || readonly} onClick={() => void update(() => toggleSocialPostLike(post.id, !post.liked))}><Heart size={18} fill={post.liked ? 'currentColor' : 'none'} /> {post.likeCount || ''}</button><button className={commentsOpen ? 'is-active' : ''} type="button" aria-label={`Комментарии: ${post.commentCount}`} onClick={toggleComments}><MessageCircle size={18} /> {post.commentCount || ''}</button></footer>
    {commentsOpen && <section className="social-comments">{!readonly && <CommentComposer postId={post.id} placeholder="Оставить комментарий" onSent={() => void refreshComments()} />}{commentsLoading && !comments ? <div className="social-comments__state"><LoaderCircle className="spin" size={18} /> Загружаем комментарии…</div> : comments?.length ? <div className="social-comments__tree">{comments.map((comment) => <CommentNode key={comment.id} comment={comment} postId={post.id} readonly={readonly} onChanged={() => void refreshComments()} />)}</div> : <div className="social-comments__state">Комментариев пока нет.</div>}{commentsError && <div className="form-error">{commentsError}</div>}</section>}
  </article>
}
