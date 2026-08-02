import { Headphones, Search } from 'lucide-react'
import { PlayerBar } from './PlayerBar'
import { SearchPalette } from './SearchPalette'

export function PublicSearchPage() {
  return (
    <div className="public-search-page">
      <header className="public-share-topbar">
        <a className="brand" href="/"><span className="brand__mark">X</span><span className="brand__word"><strong>XEDOC</strong><small>PLAY</small></span></a>
        <span><Search size={16} /> Публичный поиск</span>
        <a className="secondary-button" href="/"><Headphones size={16} /> Войти в XEDOC Play</a>
      </header>
      <main className="public-search-main">
        <SearchPalette suggestions={[]} onPlaylistPlay={() => undefined} publicMode />
      </main>
      <PlayerBar readonly onQueue={() => undefined} />
    </div>
  )
}
