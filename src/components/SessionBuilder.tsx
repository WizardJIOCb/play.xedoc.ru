import { Check, ChevronRight, Clock3, Heart, Library, Radio, RotateCcw, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { buildSession } from '../lib/api'
import { usePlayer } from '../player/PlayerContext'
import type { SessionPreferences } from '../types'

export function SessionBuilder({ open, initialDiscovery = 58, onClose }: { open: boolean; initialDiscovery?: number; onClose: () => void }) {
  const [preferences, setPreferences] = useState<SessionPreferences>({ duration: 50, discovery: 58, cooldownDays: 30, source: 'all' })
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)
  const player = usePlayer()

  useEffect(() => {
    if (!open) return
    setError('')
    setPreferences((current) => ({ ...current, discovery: initialDiscovery }))
    window.setTimeout(() => closeRef.current?.focus(), 30)
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [initialDiscovery, onClose, open])

  if (!open) return null

  const create = async () => {
    setBuilding(true)
    setError('')
    try {
      const cutoff = Date.now() - preferences.cooldownDays * 24 * 60 * 60 * 1000
      const excludeTrackIds = player.historyEntries
        .filter((entry) => entry.playedAt >= cutoff)
        .map((entry) => entry.track.id)
      const result = await buildSession({ ...preferences, excludeTrackIds })
      if (!result.tracks.length) throw new Error('Не удалось подобрать треки для этих настроек')
      player.playQueue(result.tracks)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось собрать сессию')
    } finally {
      setBuilding(false)
    }
  }

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="session-builder" role="dialog" aria-modal="true" aria-labelledby="session-title">
        <header className="session-builder__header">
          <div className="session-builder__icon"><Sparkles size={24} /></div>
          <div><span>XEDOC MIX</span><h2 id="session-title">Соберите идеальную сессию</h2><p>Укажи настроение один раз — дальше музыка течёт сама.</p></div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Закрыть"><X size={20} /></button>
        </header>

        <div className="session-builder__body">
          <fieldset>
            <legend><Clock3 size={17} /> Сколько слушаем?</legend>
            <div className="segmented">
              {([25, 50, 90] as const).map((duration) => (
                <button key={duration} className={preferences.duration === duration ? 'is-active' : ''} type="button" onClick={() => setPreferences({ ...preferences, duration })}>
                  <strong>{duration}</strong><span>минут</span>
                  {preferences.duration === duration && <Check size={15} />}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="discovery-control">
            <legend><Radio size={17} /> Баланс открытий</legend>
            <div className="discovery-control__labels"><span>Только знакомое</span><strong>{preferences.discovery}% нового</strong><span>Удиви меня</span></div>
            <input type="range" min="0" max="100" value={preferences.discovery} onChange={(event) => setPreferences({ ...preferences, discovery: Number(event.target.value) })} style={{ '--range-value': `${preferences.discovery}%` } as React.CSSProperties} />
            <div className="discovery-control__markers"><i /><i /><i /><i /><i /></div>
          </fieldset>

          <fieldset>
            <legend><RotateCcw size={17} /> Не повторять услышанное</legend>
            <div className="choice-row">
              {([7, 30, 90] as const).map((days) => (
                <button key={days} className={preferences.cooldownDays === days ? 'is-active' : ''} type="button" onClick={() => setPreferences({ ...preferences, cooldownDays: days })}>
                  {days} дней
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend><Library size={17} /> Откуда брать музыку?</legend>
            <div className="source-grid">
              <button className={preferences.source === 'all' ? 'is-active' : ''} type="button" onClick={() => setPreferences({ ...preferences, source: 'all' })}><Sparkles size={19} /><span><strong>Всё вместе</strong><small>Любимое + рекомендации</small></span></button>
              <button className={preferences.source === 'liked' ? 'is-active' : ''} type="button" onClick={() => setPreferences({ ...preferences, source: 'liked' })}><Heart size={19} /><span><strong>Только любимое</strong><small>Без экспериментов</small></span></button>
              <button className={preferences.source === 'playlists' ? 'is-active' : ''} type="button" onClick={() => setPreferences({ ...preferences, source: 'playlists' })}><Library size={19} /><span><strong>Мои плейлисты</strong><small>Смешать коллекции</small></span></button>
            </div>
          </fieldset>
        </div>

        <footer className="session-builder__footer">
          <div><span className="session-builder__wave"><i /><i /><i /><i /><i /><i /><i /></span><span><strong>≈ {Math.round(preferences.duration / 3.8)} треков</strong><small>один артист не чаще 1 раза в 6 треков</small></span></div>
          <button className="primary-button" type="button" disabled={building} onClick={() => void create()}>{building ? 'Собираем…' : 'Запустить сессию'} <ChevronRight size={18} /></button>
        </footer>
        {error && <p className="session-builder__error form-error">{error}</p>}
      </section>
    </div>
  )
}
