import { Check, Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import './SearchShareButton.css'

export function SearchShareButton({ url }: { url: string }) {
  const [state, setState] = useState<'idle' | 'copying' | 'done' | 'error'>('idle')

  useEffect(() => {
    if (state !== 'done') return
    const timeout = window.setTimeout(() => setState('idle'), 2600)
    return () => window.clearTimeout(timeout)
  }, [state])

  const copyLink = async () => {
    setState('copying')
    try {
      await navigator.clipboard.writeText(url)
      setState('done')
    } catch {
      setState('error')
    }
  }

  const label = state === 'done' ? 'Ссылка скопирована' : 'Скопировать ссылку'

  return (
    <div className="search-share">
      <button className="secondary-button search-share-button" type="button" onClick={() => void copyLink()} disabled={state === 'copying'} aria-label={label} data-tooltip={label}>
        {state === 'done' ? <Check size={16} /> : <Link2 size={16} />}
        <span>{label}</span>
      </button>
      {state === 'done' && <span className="share-button__feedback" role="status">Ссылка скопирована</span>}
      {state === 'error' && <div className="search-share__fallback" role="status">
        <span>Не удалось скопировать. Выделите ссылку и скопируйте вручную:</span>
        <input aria-label="Ссылка на результаты поиска" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
      </div>}
    </div>
  )
}
