import { ArrowUpRight, CalendarDays, Headphones, LoaderCircle, Pause, Play, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getDiscoveryRecommendations } from '../lib/api'
import { usePlayer } from '../player/PlayerContext'
import type { BootstrapPayload, DiscoveryRecommendations } from '../types'
import { CoverArt } from './CoverArt'
import { TrackTime } from './TrackTime'
import { TrackPlaybackControls } from './TrackPlaybackControls'

export function DiscoveryHero({ data, onRecommendations }: { data: BootstrapPayload; onRecommendations: () => void }) {
  const player = usePlayer()
  const [period, setPeriod] = useState<0 | 7 | 30>(0)
  const [discovery, setDiscovery] = useState<DiscoveryRecommendations>()
  const [loading, setLoading] = useState(data.catalogAvailable)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setDiscovery(undefined)
    setError(false)
    setLoading(data.catalogAvailable)
    if (data.catalogAvailable) {
      void getDiscoveryRecommendations()
        .then((result) => { if (!cancelled) setDiscovery(result) })
        .catch(() => { if (!cancelled) setError(true) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }
    return () => { cancelled = true }
  }, [data.catalogAvailable, data.appUser?.id, attempt])

  const collection = data.xedocCollections.find((item) => item.periodDays === period)
  const tracks = period === 0 ? discovery?.tracks || [] : collection?.tracks || []
  const busy = period === 0 && loading
  const failed = period === 0 && error
  const title = period === 0 ? 'Новые для вас' : period === 7 ? 'Ваша неделя в музыке' : 'Ваш месяц в музыке'
  const description = period === 0
    ? 'Откройте треки за пределами привычного. Подбираем по вашему вкусу и исключаем знакомое.'
    : collection?.fallback
      ? 'В этом периоде пока мало прослушиваний. Начните с рекомендаций по вашему вкусу.'
      : period === 7 ? 'Треки, к которым вы возвращались последние семь дней. Собрали их в одну подборку.' : 'Музыка, которая звучала у вас последние 30 дней. Включите всё самое любимое ещё раз.'

  return (
    <section className="discovery-hero" aria-label="Музыкальные открытия">
      <header className="discovery-hero__header">
        <span className="discovery-hero__eyebrow"><Sparkles size={15} /> ВАША МУЗЫКАЛЬНАЯ НАХОДКА</span>
        <div className="discovery-hero__filters" role="group" aria-label="Выбор подборки">
          {([0, 7, 30] as const).map((days) => <button key={days} type="button" aria-pressed={period === days} onClick={() => setPeriod(days)}>{days === 0 ? <Sparkles size={14} /> : <CalendarDays size={14} />}{days === 0 ? 'Новые для вас' : days === 7 ? 'За неделю' : 'За месяц'}</button>)}
        </div>
      </header>
      <div className="discovery-hero__body">
        <div className="discovery-hero__copy">
          <h2>{title}</h2>
          <p>{description}</p>
          <div className="discovery-hero__actions">
            <button className="primary-button" type="button" disabled={busy || !tracks.length} onClick={() => player.playQueue(tracks)}>{busy ? <LoaderCircle className="spin" size={18} /> : <Play size={18} fill="currentColor" />}{period === 0 ? 'Слушать новое' : 'Слушать подборку'}</button>
            <button className="discovery-hero__more" type="button" onClick={onRecommendations}>Все рекомендации <ArrowUpRight size={17} /></button>
          </div>
          {tracks.length > 0 && <span className="discovery-hero__meta"><Headphones size={14} /> {tracks.length} треков · {Math.round(tracks.reduce((sum, track) => sum + track.durationMs, 0) / 60000)} мин{period === 0 && discovery?.seedCount === 0 ? ' · Начинаем с популярного в XEDOC' : ''}</span>}
        </div>
        <div className="discovery-hero__preview" aria-busy={busy}>
          {busy ? <div className="discovery-hero__status" role="status"><LoaderCircle className="spin" size={25} /><span>Ищем музыку для новых открытий…</span></div>
            : failed ? <div className="discovery-hero__status" role="status"><span>Не удалось загрузить новые треки.</span><button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Попробовать снова</button></div>
              : tracks.length ? tracks.slice(0, 3).map((track) => {
                const active = player.current?.id === track.id
                const playing = active && player.isPlaying
                return <div className={`discovery-hero__track ${playing ? 'is-playing' : ''}`} key={track.id}><button className="discovery-hero__track-main" type="button" aria-label={`${playing ? 'Пауза' : 'Включить'} ${track.title}`} onClick={() => active ? player.togglePlayback() : player.playTrack(track, tracks)}>
                  <div className="discovery-hero__art"><CoverArt title={track.title} url={track.coverUrl} tone={track.coverTone} /><span className="discovery-hero__play">{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</span></div>
                  <strong>{track.title}</strong><small>{track.artists.join(', ')}</small>
                  <TrackTime track={track} />
                </button>{active && <TrackPlaybackControls track={track} />}</div>
              }) : <div className="discovery-hero__status" role="status"><Sparkles size={25} /><span>{period === 0 ? 'Послушайте несколько треков — здесь появятся новые открытия.' : 'В этом периоде пока нет треков. Ваша подборка появится после прослушиваний.'}</span></div>}
        </div>
      </div>
    </section>
  )
}
