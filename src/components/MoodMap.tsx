import { Activity, Compass, Radio, Sparkles } from 'lucide-react'
import { useState, type CSSProperties } from 'react'

export const moodDirections = {
  deep: { choice: 'Глубже в знакомое', title: 'Глубокий фокус', description: 'Больше музыки рядом с любимой — без резких жанровых поворотов.', energy: 42, novelty: 28 },
  fresh: { choice: 'Больше нового', title: 'Новые открытия', description: 'Смелее отходим от вашей коллекции, сохраняя узнаваемый характер.', energy: 58, novelty: 88 },
  bright: { choice: 'Больше энергии', title: 'Энергичный разгон', description: 'Поднимаем темп и выбираем более яркие треки без случайного шума.', energy: 88, novelty: 55 },
  calm: { choice: 'Спокойный ритм', title: 'Спокойный поток', description: 'Мягкая динамика, ровное настроение и минимум резких переходов.', energy: 20, novelty: 40 },
} as const

type MoodId = keyof typeof moodDirections
type MoodSelection = MoodId | 'custom'

export type MoodSettings = {
  energy: number
  novelty: number
}

function MoodMeter({ title, value, low, high, onChange }: { title: string; value: number; low: string; high: string; onChange: (value: number) => void }) {
  return (
    <div className="mood-meter">
      <header><span>{title}</span><strong>{value}%</strong></header>
      <input
        className="mood-meter__range"
        type="range"
        min="0"
        max="100"
        step="1"
        value={value}
        aria-label={title}
        aria-valuetext={`${value} процентов`}
        data-tooltip-disabled="true"
        style={{ '--mood-value': `${value}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <footer><small>{low}</small><small>{high}</small></footer>
    </div>
  )
}

function customDirection({ energy, novelty }: MoodSettings) {
  const title = energy >= 70 && novelty >= 70
    ? 'Энергичные открытия'
    : energy >= 70
      ? 'Яркий знакомый ритм'
      : novelty >= 70
        ? 'Свежий спокойный поток'
        : energy <= 30
          ? 'Мягкий личный поток'
          : 'Своя настройка'
  return { title, description: 'Вы задали характер подборки вручную. Значения можно менять независимо друг от друга.' }
}

export function MoodMap({ onSession }: { onSession: (settings: MoodSettings) => void }) {
  const [mood, setMood] = useState<MoodSelection>('deep')
  const [settings, setSettings] = useState<MoodSettings>({ energy: moodDirections.deep.energy, novelty: moodDirections.deep.novelty })
  const direction = mood === 'custom' ? customDirection(settings) : moodDirections[mood]

  const choosePreset = (id: MoodId) => {
    setMood(id)
    setSettings({ energy: moodDirections[id].energy, novelty: moodDirections[id].novelty })
  }

  const changeSetting = (key: keyof MoodSettings, value: number) => {
    setMood('custom')
    setSettings((current) => ({ ...current, [key]: value }))
  }

  return (
    <section className="mood-map">
      <div className="mood-map__intro">
        <span className="eyebrow">НАСТРОЕНИЕ РЕКОМЕНДАЦИЙ</span>
        <h2>Как должна звучать музыка?</h2>
        <p>Выберите понятное направление — мы учтём энергию и долю новых треков.</p>
        <div className="mood-map__choices" aria-label="Направление рекомендаций">
          {(Object.entries(moodDirections) as Array<[MoodId, (typeof moodDirections)[MoodId]]>).map(([id, item]) => (
            <button key={id} className={mood === id ? 'is-active' : ''} type="button" onClick={() => choosePreset(id)}>{item.choice}</button>
          ))}
        </div>
        <button className="primary-button" type="button" onClick={() => onSession(settings)}><Radio size={18} /> Настроить волну</button>
      </div>

      <div className={`mood-map__profile mood-map__profile--${mood}`} aria-live="polite">
        <header className="mood-map__profile-heading">
          <span className="mood-map__profile-icon"><Compass size={22} /></span>
          <span><small>{mood === 'custom' ? 'РУЧНАЯ НАСТРОЙКА' : 'ТЕКУЩЕЕ НАПРАВЛЕНИЕ'}</small><strong>{direction.title}</strong></span>
        </header>
        <p>{direction.description}</p>
        <div className="mood-map__meters">
          <MoodMeter title="Энергия" value={settings.energy} low="Спокойно" high="Энергично" onChange={(value) => changeSetting('energy', value)} />
          <MoodMeter title="Новизна" value={settings.novelty} low="Знакомое" high="Совсем новое" onChange={(value) => changeSetting('novelty', value)} />
        </div>
        <div className="mood-map__summary"><Activity size={16} /><span><strong>{settings.energy}% энергии</strong><i />{settings.novelty}% нового</span></div>
        <small className="mood-map__explanation"><Sparkles size={14} /> Новизна будет перенесена в конструктор следующей музыкальной сессии.</small>
      </div>
    </section>
  )
}
