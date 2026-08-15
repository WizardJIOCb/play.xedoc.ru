import { BarChart3, Globe2, ImagePlus, Link2, LoaderCircle, Music2, Send, UsersRound, Video } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createSocialPost, getSocialFeed } from '../lib/api'
import type { AppUser, Playlist, SocialAttachment, SocialPost, Track } from '../types'
import { SocialPostCard } from './SocialPostCard'

export function SocialFeedPage({ user, tracks, playlists }: { user?: AppUser; tracks: Track[]; playlists: Playlist[] }) {
  const [mode, setMode] = useState<'for-you' | 'friends'>('for-you')
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'friends'>('public')
  const [attachments, setAttachments] = useState<SocialAttachment[]>([])
  const [urlMode, setUrlMode] = useState<'link' | 'video'>()
  const [url, setUrl] = useState('')
  const [pollOpen, setPollOpen] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const imageInput = useRef<HTMLInputElement>(null)

  const load = () => {
    setLoading(true); setError('')
    void getSocialFeed(mode).then((value) => setPosts(value.posts)).catch(() => setError('Не удалось загрузить ленту.')).finally(() => setLoading(false))
  }
  useEffect(load, [mode])

  const addUrl = () => {
    const value = url.trim()
    if (!value || !urlMode) return
    setAttachments((items) => [...items, { kind: urlMode, url: value, title: urlMode === 'video' ? 'Видео' : undefined } as SocialAttachment])
    setUrl(''); setUrlMode(undefined)
  }
  const addImage = (file?: File) => {
    if (!file) return
    if (file.size > 1_500_000) { setError('Изображение должно быть меньше 1,5 МБ.'); return }
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' && setAttachments((items) => [...items, { kind: 'image', url: reader.result as string, title: file.name }])
    reader.readAsDataURL(file)
  }
  const publish = async () => {
    const options = pollOptions.map((text) => text.trim()).filter(Boolean)
    if (!body.trim() && !attachments.length && !(pollOpen && pollQuestion.trim() && options.length >= 2)) return
    setSending(true); setError('')
    try {
      const post = await createSocialPost({ body, visibility, attachments, ...(pollOpen && pollQuestion.trim() && options.length >= 2 ? { poll: { question: pollQuestion.trim(), options: options.map((text) => ({ text })) } } : {}) })
      setPosts((items) => [post, ...items]); setBody(''); setAttachments([]); setPollOpen(false); setPollQuestion(''); setPollOptions(['', ''])
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось опубликовать запись.') } finally { setSending(false) }
  }

  return <div className="social-feed-page">
    <section className="social-composer">
      <div className="social-composer__identity"><span className="social-avatar">{user?.displayName?.charAt(0).toUpperCase() || 'X'}</span><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={5000} placeholder="Что сейчас звучит, зацепило или случилось?" /></div>
      {attachments.length > 0 && <div className="social-composer__chips">{attachments.map((attachment, index) => <button key={index} type="button" onClick={() => setAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))}>{attachment.kind === 'track' ? attachment.track.title : attachment.kind === 'playlist' ? attachment.playlist.title : attachment.title || attachment.url} ×</button>)}</div>}
      {urlMode && <div className="social-composer__url"><input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder={urlMode === 'video' ? 'Ссылка на MP4, YouTube или Rutube' : 'https://…'} /><button type="button" onClick={addUrl}>Прикрепить</button></div>}
      {pollOpen && <div className="social-composer__poll"><input value={pollQuestion} onChange={(event) => setPollQuestion(event.target.value)} placeholder="Вопрос опроса" />{pollOptions.map((option, index) => <input key={index} value={option} onChange={(event) => setPollOptions((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={`Вариант ${index + 1}`} />)}{pollOptions.length < 8 && <button type="button" onClick={() => setPollOptions((items) => [...items, ''])}>+ вариант</button>}</div>}
      <div className="social-composer__footer">
        <div><input ref={imageInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => addImage(event.target.files?.[0])} /><button type="button" title="Изображение" onClick={() => imageInput.current?.click()}><ImagePlus size={18} /></button><button type="button" title="Видео" onClick={() => setUrlMode(urlMode === 'video' ? undefined : 'video')}><Video size={18} /></button><button type="button" title="Ссылка" onClick={() => setUrlMode(urlMode === 'link' ? undefined : 'link')}><Link2 size={18} /></button><select aria-label="Прикрепить трек" value="" onChange={(event) => { const track = tracks.find((item) => item.id === event.target.value); if (track) setAttachments((items) => [...items, { kind: 'track', track }]) }}><option value="">♫ Трек</option>{tracks.slice(0, 30).map((track) => <option key={track.id} value={track.id}>{track.title} — {track.artists.join(', ')}</option>)}</select><select aria-label="Прикрепить плейлист" value="" onChange={(event) => { const playlist = playlists.find((item) => item.id === event.target.value); if (playlist) setAttachments((items) => [...items, { kind: 'playlist', playlist }]) }}><option value="">▤ Плейлист</option>{playlists.slice(0, 30).map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.title}</option>)}</select><button className={pollOpen ? 'is-active' : ''} type="button" title="Опрос" onClick={() => setPollOpen((value) => !value)}><BarChart3 size={18} /></button></div>
        <span><button className="social-visibility" type="button" onClick={() => setVisibility((value) => value === 'public' ? 'friends' : 'public')}>{visibility === 'public' ? <Globe2 size={15} /> : <UsersRound size={15} />}{visibility === 'public' ? 'Всем' : 'Друзьям'}</button><button className="primary-button" type="button" disabled={sending} onClick={() => void publish()}>{sending ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />} Опубликовать</button></span>
      </div>
      {error && <div className="form-error">{error}</div>}
    </section>
    <div className="social-feed-tabs"><button className={mode === 'for-you' ? 'is-active' : ''} type="button" onClick={() => setMode('for-you')}>Для вас</button><button className={mode === 'friends' ? 'is-active' : ''} type="button" onClick={() => setMode('friends')}>Друзья</button></div>
    {loading ? <div className="social-feed-state"><LoaderCircle className="spin" size={24} /> Собираем ленту…</div> : posts.length ? <div className="social-feed-list">{posts.map((post) => <SocialPostCard key={post.id} post={post} onDeleted={(id) => setPosts((items) => items.filter((item) => item.id !== id))} />)}</div> : <div className="social-feed-state"><Music2 size={27} /><strong>Лента пока тихая</strong><span>Опубликуйте первую запись или добавьте друзей с похожим вкусом.</span></div>}
  </div>
}
