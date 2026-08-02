import { Play } from 'lucide-react'
import type { CoverTone } from '../types'

interface CoverArtProps {
  title: string
  url?: string
  tone?: CoverTone
  className?: string
  playable?: boolean
  onPlay?: () => void
}

export function CoverArt({ title, url, tone = 'violet', className = '', playable = false, onPlay }: CoverArtProps) {
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')

  return (
    <div className={`cover cover--${tone} ${className}`} style={url ? { backgroundImage: `url("${url.replace('%%', '400x400')}")` } : undefined}>
      {!url && (
        <>
          <span className="cover__orb" />
          <span className="cover__initials">{initials}</span>
        </>
      )}
      {playable && (
        <button className="cover__play" type="button" aria-label={`Включить ${title}`} onClick={(event) => { event.stopPropagation(); onPlay?.() }}>
          <Play size={19} fill="currentColor" />
        </button>
      )}
    </div>
  )
}
