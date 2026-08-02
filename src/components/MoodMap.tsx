import { Activity, Compass, Radio, Sparkles } from 'lucide-react'
import { useState } from 'react'

export const moodDirections = {
  deep: { choice: 'Глубже в знакомое', title: 'Глубокий фокус', description: 'Больше музыки рядом с любимой — без резких жанровых поворотов.', energy: 42, novelty: 28 },
  fresh: { choice: 'Больше нового', title: 'Новые открытия', description: 'Смелее отходим от вашей коллекции, сохраняя узнаваемый характер.', energy: 58, novelty: 88 },
  bright: { choice: 'Больше энергии', title: 'Энергичный разгон', description: 'Поднимаем темп и выбираем более яркие треки без случайного шума.', energy: 88, novelty: 55 },
  calm: { choice: 'Спокойный ритм', title: 'Спокойный поток', description: 'Мягкая динамика, ровное настроение и минимум резких переходов.', energy: 20, novelty: 40 },
} as const

type MoodId = keyof typeof moodDirections

function MoodMeter({ title, value, low, high }: { title: string; value: number; low: string; high: string }) {
  return (
    <div className="mood-meter">
      <header><span>{title}</span><strong>{value}%</strong></header>
      <div className="mood-meter__bar" role="img" aria-label={`${title}: ${value}%`}><span style={{ width: `${value}%` }}><i /></span></div>
      <footer><small>{low}</small><small>{high}</small></footer>
    </div>
  )
}

export function MoodMap({ onSession }: { onSession: () => void }) {
  const [mood, setMood] = useState<MoodId>('deep')
  const direction = moodDirections[mood]

  return (
    <section className="mood-map">
      <div className="mood-map__intro">
        <span className="eyebrow">НАСТРОЕНИЕ РЕКОМЕНДАЦИЙ</span>
        <h2>Как должна звучать музыка?</h2>
        <p>Выберите понятное направление — мы учтём энергию и долю новых треков.</p>
        <div className="mood-map__choices" aria-label="Направление рекомендаций">
          {(Object.entries(moodDirections) as Array<[MoodId, (typeof moodDirections)[MoodId]]>).map(([id, item]) => (
            <button key={id} className={mood === id ? 'is-active' : ''} type="button" onClick={() => setMood(id)}>{item.choice}</button>
          ))}
        </div>
        <button className="primary-button" type="button" onClick={onSession}><Radio size={18} /> Настроить волну</button>
      </div>

      <div className={`mood-map__profile mood-map__profile--${mood}`} aria-live="polite">
        <header className="mood-map__profile-heading">
          <span className="mood-map__profile-icon"><Compass size={22} /></span>
          <span><small>ТЕКУЩЕЕ НАПРАВЛЕНИЕ</small><strong>{direction.title}</strong></span>
        </header>
        <p>{direction.description}</p>
        <div className="mood-map__meters">
          <MoodMeter title="Энергия" value={direction.energy} low="Спокойно" high="Энергично" />
          <MoodMeter title="Новизна" value={direction.novelty} low="Знакомое" high="Совсем новое" />
        </div>
        <div className="mood-map__summary"><Activity size={16} /><span><strong>{direction.energy}% энергии</strong><i />{direction.novelty}% нового</span></div>
        <small className="mood-map__explanation"><Sparkles size={14} /> Настройка повлияет на следующую музыкальную сессию.</small>
      </div>
    </section>
  )
}
