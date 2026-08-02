import { Bookmark, Check, CheckCircle2, ChevronDown, Copy, ExternalLink, Headphones, Import, LoaderCircle, LogOut, Music2, RotateCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { disconnectYandex, getLatestVKImportJob, importVKTracks } from '../lib/api'
import type { VKImportJob } from '../types'

interface SourcesModalProps {
  open: boolean
  yandexConnected: boolean
  onClose: () => void
  onConnectYandex: () => void
  onChanged: () => void
}

function parseTracks(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const parts = line.split(/\s+[—–-]\s+/, 2)
    if (parts.length !== 2) return []
    return [{ artist: parts[0].trim(), title: parts[1].trim() }]
  })
}

function canonicalVKUrl(value: string) {
  try {
    const url = new URL(value.trim())
    const match = url.pathname.replace(/\/$/, '').match(/^\/audios(-?\d+)$/)
    if (url.protocol !== 'https:' || !['vk.ru', 'www.vk.ru', 'vk.com', 'www.vk.com'].includes(url.hostname) || !match) return ''
    return `https://vk.ru/audios${match[1]}`
  } catch {
    return ''
  }
}

function buildCollector(destination: string) {
  const collector = async () => {
    const destinationValue = '__DESTINATION__'
    const wait = (delay: number) => new Promise((resolve) => window.setTimeout(resolve, delay))
    const id = window.location.pathname.replace(/\/$/, '').match(/^\/audios(-?\d+)$/)?.[1]
    if (!id) { window.alert('Откройте в VK страницу «Моя музыка» из XEDOC.'); return }
    let badge = document.getElementById('xedoc-vk-collector')
    if (!badge) {
      badge = document.createElement('div')
      badge.id = 'xedoc-vk-collector'
      badge.setAttribute('style', 'position:fixed;z-index:2147483647;right:24px;top:24px;max-width:340px;padding:16px 18px;border:1px solid #d9ff63;border-radius:14px;background:#111319;color:#f5f5f3;font:600 15px system-ui;box-shadow:0 18px 60px #0008')
      document.body.appendChild(badge)
    }
    badge.textContent = 'XEDOC: загружаем весь список VK…'
    let previous = -1
    let stable = 0
    for (let index = 0; index < 1200 && stable < 20; index += 1) {
      const section = document.querySelector('[data-testid="AudioCatalog_SectionTracks"]')
      const count = section?.querySelectorAll('[data-testid="MusicTrackRow"]').length ?? 0
      badge.textContent = `XEDOC: найдено ${count} треков…`
      const nearBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) < window.innerHeight * 1.5
      stable = nearBottom && count === previous ? stable + 1 : 0
      previous = count
      const rows = document.querySelectorAll('[data-testid="AudioCatalog_SectionTracks"] [data-testid="MusicTrackRow"]')
      rows[rows.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      await wait(650)
    }
    const rows = Array.from(document.querySelectorAll('[data-testid="AudioCatalog_SectionTracks"] [data-testid="MusicTrackRow"]'))
    const unique = new Map<string, { title: string; artist: string; duration?: string }>()
    for (const row of rows) {
      const title = row.querySelector('[data-testid="MusicTrackRow_Title"]')?.textContent?.trim() ?? ''
      const artist = row.querySelector('[data-testid="MusicTrackRow_Authors"]')?.textContent?.trim() ?? ''
      const duration = row.querySelector('[data-testid="MusicTrackRow_Duration"]')?.textContent?.trim() ?? ''
      if (title && artist) unique.set(`${artist.toLocaleLowerCase()}\u0000${title.toLocaleLowerCase()}`, { title, artist, ...(duration ? { duration } : {}) })
    }
    const tracks = Array.from(unique.values()).slice(0, 10000)
    if (!tracks.length) { badge.textContent = 'XEDOC: треки не найдены. Откройте раздел «Моя музыка».'; return }
    badge.textContent = `XEDOC: передаём ${tracks.length} треков…`
    const json = JSON.stringify({ sourceUrl: `https://vk.ru/audios${id}`, tracks })
    const bytes = new TextEncoder().encode(json)
    let payload = bytes
    let format = 'j'
    if ('CompressionStream' in window) {
      const compressed = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
      payload = new Uint8Array(await new Response(compressed).arrayBuffer())
      format = 'g'
    }
    let binary = ''
    for (let offset = 0; offset < payload.length; offset += 8192) {
      binary += String.fromCharCode(...payload.subarray(offset, offset + 8192))
    }
    const encoded = window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    badge.textContent = `XEDOC: передаём ${tracks.length} треков и возвращаемся в плеер…`
    window.location.href = `${destinationValue}#${format}.${encoded}`
  }
  return `javascript:(${collector.toString().replace('__DESTINATION__', destination)})()`
}

export function SourcesModal({ open, yandexConnected, onClose, onConnectYandex, onChanged }: SourcesModalProps) {
  const [sourceUrl, setSourceUrl] = useState('')
  const [trackText, setTrackText] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [collector, setCollector] = useState('')
  const [copied, setCopied] = useState(false)
  const [job, setJob] = useState<VKImportJob | null>(null)
  const bookmarkRef = useRef<HTMLAnchorElement>(null)
  const tracks = useMemo(() => parseTracks(trackText), [trackText])
  const vkUrl = useMemo(() => canonicalVKUrl(sourceUrl), [sourceUrl])

  const refreshJob = useCallback(async () => {
    try { setJob(await getLatestVKImportJob()) } catch { /* Progress is optional. */ }
  }, [])

  useEffect(() => {
    if (!open) { setError(''); setMessage(''); setLoading(false); return undefined }
    void refreshJob()
    const interval = window.setInterval(() => void refreshJob(), 3000)
    return () => window.clearInterval(interval)
  }, [open, refreshJob])

  useEffect(() => {
    if (bookmarkRef.current && collector) bookmarkRef.current.setAttribute('href', collector)
  }, [collector])

  useEffect(() => {
    if (job?.status === 'complete') onChanged()
  }, [job?.status, onChanged])

  if (!open) return null

  const importVK = async () => {
    setLoading(true); setError(''); setMessage('')
    try {
      const result = await importVKTracks(sourceUrl, tracks)
      setMessage(`Готово: ${result.matched} треков найдено в подключённом каталоге, ${result.unmatched.length} сохранено как сигналы вкуса.`)
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось импортировать список')
    } finally {
      setLoading(false)
    }
  }

  const prepareCollector = () => {
    setError(''); setMessage('')
    setCollector(buildCollector(`${window.location.origin}/?vkImport=collect`))
  }

  const copyCollector = async () => {
    await navigator.clipboard.writeText(collector)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const progress = job?.total ? Math.round(job.processed / job.total * 100) : 0

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="sources-modal" role="dialog" aria-modal="true" aria-labelledby="sources-title">
        <header><div><span className="eyebrow">ИСТОЧНИКИ МУЗЫКИ</span><h2 id="sources-title">Подключения и импорт</h2><p>Соберите коллекцию и музыкальный вкус в одном аккаунте XEDOC.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть"><X size={20} /></button></header>
        <div className="source-card">
          <div className="source-card__icon source-card__icon--yandex"><Music2 size={23} /></div>
          <div><h3>Яндекс Музыка</h3><p>Плейлисты, лайки, поиск и воспроизведение через официальное подключение.</p></div>
          {yandexConnected ? <div className="source-card__actions"><span className="source-status"><CheckCircle2 size={15} /> Подключено</span><button className="icon-button" type="button" data-tooltip="Отключить Яндекс Музыку" aria-label="Отключить Яндекс Музыку" onClick={() => { setLoading(true); void disconnectYandex().then(onChanged).finally(() => setLoading(false)) }}><LogOut size={17} /></button></div> : <button className="secondary-button" type="button" onClick={() => { onClose(); onConnectYandex() }}><Headphones size={17} /> Подключить</button>}
        </div>
        <div className="source-card source-card--vk">
          <div className="source-card__icon source-card__icon--vk">VK</div>
          <div className="source-card__vk-content">
            <h3>Весь список из VK по ссылке</h3>
            <p>VK показывает коллекцию только вашей авторизованной вкладке. Персональная кнопка XEDOC прокрутит список до конца и передаст названия — без пароля и cookies VK.</p>
            <input value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); setCollector('') }} placeholder="https://vk.ru/audios145429079" aria-label="Ссылка на страницу аудиозаписей VK" />
            {!collector ? <button className="primary-button source-card__prepare" type="button" disabled={!vkUrl || loading} onClick={prepareCollector}>{loading ? <LoaderCircle className="spin" size={17} /> : <Bookmark size={17} />} Подготовить автоимпорт</button> : <div className="vk-collector-setup">
              <ol><li>Перетащите кнопку ниже на панель закладок браузера.</li><li>Откройте вашу «Мою музыку» по ссылке.</li><li>На странице VK нажмите сохранённую закладку — остальное произойдёт автоматически.</li></ol>
              <div><a ref={bookmarkRef} className="vk-bookmarklet" draggable="true"><Bookmark size={17} /> Забрать все треки в XEDOC</a><button className="icon-button" type="button" onClick={() => void copyCollector()} data-tooltip="Скопировать код кнопки" aria-label="Скопировать код кнопки">{copied ? <Check size={17} /> : <Copy size={17} />}</button></div>
              <div className="vk-collector-actions"><a className="secondary-button" href={`${vkUrl}?section=all`} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Открыть мою музыку VK</a><button type="button" onClick={prepareCollector}><RotateCw size={14} /> Обновить кнопку</button></div>
            </div>}
            {job && <div className={`vk-import-progress vk-import-progress--${job.status}`}><div><strong>{job.status === 'complete' ? 'Импорт завершён' : job.status === 'failed' ? 'Импорт остановлен' : 'Собираем плейлист'}</strong><span>{job.processed} из {job.total} · найдено {job.matched}</span></div><div className="vk-import-progress__bar"><i style={{ width: `${progress}%` }} /></div>{job.error && <small>{job.error}</small>}</div>}
            <details className="vk-manual-import"><summary>Ручной импорт списка <ChevronDown size={15} /></summary><p>Можно вставить строки в формате «Исполнитель — Название».</p><textarea value={trackText} onChange={(event) => setTrackText(event.target.value)} placeholder={'Limp Bizkit — Lonely World\nКино — Группа крови'} aria-label="Список треков из VK" /><div className="source-card__import"><small>Распознано строк: {tracks.length}</small><button className="secondary-button" type="button" disabled={!tracks.length || !vkUrl || loading} onClick={() => void importVK()}>{loading ? <LoaderCircle className="spin" size={17} /> : <Import size={17} />} Импортировать</button></div></details>
            <small className="source-card__note">В XEDOC передаются только названия, исполнители и длительность. Сам звук проигрывается из подключённого музыкального каталога.</small>
          </div>
        </div>
        {message && <p className="form-success">{message}</p>}
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  )
}
