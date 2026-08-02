import { CheckCircle2, Headphones, Import, LoaderCircle, LogOut, Music2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { disconnectYandex, importVKTracks } from '../lib/api'

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

export function SourcesModal({ open, yandexConnected, onClose, onConnectYandex, onChanged }: SourcesModalProps) {
  const [sourceUrl, setSourceUrl] = useState('https://vk.ru/audios')
  const [trackText, setTrackText] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const tracks = useMemo(() => parseTracks(trackText), [trackText])

  useEffect(() => {
    if (!open) { setError(''); setMessage(''); setLoading(false) }
  }, [open])

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
          <div className="source-card__vk-content"><h3>Музыкальный вкус из VK</h3><p>Вставьте список строк в формате «Исполнитель — Название». XEDOC найдёт доступные версии в подключённом каталоге, создаст плейлист и учтёт остальные треки в рекомендациях.</p>
            <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Ссылка на источник VK" aria-label="Ссылка на страницу аудиозаписей VK" />
            <textarea value={trackText} onChange={(event) => setTrackText(event.target.value)} placeholder={'Limp Bizkit — Lonely World\nКино — Группа крови'} aria-label="Список треков из VK" />
            <div className="source-card__import"><small>Распознано строк: {tracks.length}</small><button className="primary-button" type="button" disabled={!tracks.length || loading} onClick={() => void importVK()}>{loading ? <LoaderCircle className="spin" size={17} /> : <Import size={17} />} Импортировать</button></div>
            <small className="source-card__note">XEDOC не запрашивает пароль VK и не обходит ограничения сервиса. Сам звук проигрывается только из легально подключённого каталога.</small>
          </div>
        </div>
        {message && <p className="form-success">{message}</p>}
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  )
}
