import { AudioLines, ChevronDown, ChevronUp, CircleAlert, Clock3, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createMusicGeneration, getMusicGenerations, retryMusicGenerationUpload } from '../lib/api'
import type { MusicGeneration } from '../types'
import { PlaylistPicker } from './PlaylistPicker'

const statusCopy: Record<MusicGeneration['status'], string> = {
  queued: 'Ждёт свободный GPU', running: 'YuE2 пишет трек', completed: 'Готово', failed: 'Остановилось с ошибкой',
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }).format(value * 1000)
}

export function GenerationPage() {
  const [jobs, setJobs] = useState<MusicGeneration[]>([])
  const [title, setTitle] = useState('Новый трек')
  const [style, setStyle] = useState('Русский инди-поп, тёплый вокал, живые барабаны, ночной город')
  const [lyrics, setLyrics] = useState('[Verse]\nWrite your lyrics in English\n\n[Chorus]\nRepeat the central idea')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [retryingId, setRetryingId] = useState('')
  const [expandedLyricsId, setExpandedLyricsId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const refresh = () => getMusicGenerations().then(setJobs).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Не удалось получить список генераций')).finally(() => setLoading(false))

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [])

  const active = jobs.some((job) => job.status === 'queued' || job.status === 'running')
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!/^[\x00-\x7F]+$/.test(lyrics) || !/[A-Za-z]/.test(lyrics)) {
      setError('YuE2 сейчас принимает текст песни только на английском: используйте латиницу и обычные английские символы.')
      return
    }
    setSubmitting(true)
    setError('')
    void createMusicGeneration({ title, style, lyrics }).then((job) => setJobs((current) => [job, ...current])).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Не удалось поставить трек в очередь')).finally(() => setSubmitting(false))
  }

  const retryUpload = (jobId: string) => {
    setRetryingId(jobId)
    setError('')
    void retryMusicGenerationUpload(jobId)
      .then((job) => setJobs((current) => current.map((item) => item.id === job.id ? job : item)))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Не удалось проверить готовый файл'))
      .finally(() => setRetryingId(''))
  }

  return <section className="generation-page">
    <header className="generation-page__hero"><div><span className="eyebrow"><Sparkles size={14} /> XEDOC GENERATE</span><h1>Сгенерировать трек</h1><p>YuE2 работает на моём компе. Русский стиль переведём перед генерацией; текст песни нужен на английском.</p></div><div className="generation-page__gpu"><AudioLines size={24} /><span>RTX 4070 Ti</span><small>один трек за раз</small></div></header>
    <form className="generation-form" onSubmit={submit}>
      <label><span>Название</span><input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} required /></label>
      <label><span>Стиль и аранжировка</span><textarea value={style} maxLength={500} onChange={(event) => setStyle(event.target.value)} required rows={3} placeholder="Жанр, инструменты, голос, настроение, темп" /><small>Русские музыкальные теги автоматически переведутся на английский для YuE2.</small></label>
      <label><span>Текст песни — только английский</span><textarea value={lyrics} maxLength={1800} onChange={(event) => setLyrics(event.target.value)} required rows={10} placeholder={'[Verse]\n...\n\n[Chorus]\n...'} /><small>YuE2 надёжно поёт только английский текст. Русские буквы не будут приняты.</small></label>
      <div className="generation-form__footer"><small>Только свои тексты и музыка, на которую у вас есть права. Весы YuE2 — для некоммерческого использования.</small><button className="primary-button" type="submit" disabled={submitting || active}>{submitting ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}{active ? 'Трек уже в очереди' : 'Сгенерировать'}</button></div>
      {error && <p className="generation-form__error"><CircleAlert size={16} /> {error}</p>}
    </form>
    <section className="generation-history"><header><div><span className="eyebrow">МОИ ГЕНЕРАЦИИ</span><h2>Последние треки</h2></div><button type="button" className="secondary-button" onClick={() => { setLoading(true); refresh() }}>Обновить</button></header>
      {loading ? <div className="generation-history__empty"><LoaderCircle className="spin" size={23} /> Загружаем задачи…</div> : !jobs.length ? <div className="generation-history__empty">Пока здесь тихо. Первый трек будет ждать вас здесь.</div> : <div className="generation-job-list">{jobs.map((job) => {
        const canRetryUpload = job.status === 'failed' && Boolean(job.retryUploadAvailable)
        const lyricsExpanded = expandedLyricsId === job.id
        return <article key={job.id} className={`generation-job generation-job--${job.status}`}><div className="generation-job__top"><div><strong>{job.title}</strong><span>{job.style}</span></div><b>{statusCopy[job.status]}</b></div><div className="generation-job__meta"><span><Clock3 size={14} /> {formatTime(job.createdAt)}</span>{job.durationMs ? <span>{Math.round(job.durationMs / 1000)} с</span> : null}</div><button className="generation-job__lyrics-toggle" type="button" aria-expanded={lyricsExpanded} aria-controls={`generation-lyrics-${job.id}`} onClick={() => setExpandedLyricsId((current) => current === job.id ? null : job.id)}>{lyricsExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}{lyricsExpanded ? 'Скрыть текст песни' : 'Показать текст песни'}</button>{lyricsExpanded && <div className="generation-job__lyrics" id={`generation-lyrics-${job.id}`}><span>Текст песни</span><p>{job.lyrics}</p></div>}{job.status === 'completed' && job.track && <div className="generation-job__completed-actions"><span><Sparkles size={14} /> Сгенерировано YuE2</span><div><small>В мой плейлист</small><PlaylistPicker track={job.track} /></div></div>}{job.status === 'completed' && job.streamUrl ? <audio controls preload="metadata" src={job.streamUrl}>Ваш браузер не поддерживает воспроизведение аудио.</audio> : null}{job.status === 'failed' && <><p className="generation-job__error">{job.error || 'Неизвестная ошибка генератора'}</p>{canRetryUpload && <div className="generation-job__retry"><small>Трек уже создан на вашем компе. Проверим файл и повторим только загрузку.</small><button className="secondary-button" type="button" onClick={() => retryUpload(job.id)} disabled={Boolean(retryingId)}>{retryingId === job.id ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{retryingId === job.id ? 'Проверяем…' : 'Проверить готовность'}</button></div>}</>}</article>
      })}</div>}
    </section>
  </section>
}
