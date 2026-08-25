import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PlayerProvider } from './player/PlayerContext'
import { installSpaPageTracking } from './lib/analytics'
import { SiteToolsBridge } from './components/SiteToolsBridge'
import './style.css'

installSpaPageTracking()

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <PlayerProvider>
      <SiteToolsBridge />
      <App />
    </PlayerProvider>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'))
}
