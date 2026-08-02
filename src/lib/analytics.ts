export const METRIKA_COUNTER_ID = 111248018

export type AnalyticsGoal =
  | 'auth_login'
  | 'auth_register'
  | 'music_play'
  | 'music_resume'
  | 'playlist_play'
  | 'playlist_created'
  | 'playlist_track_added'
  | 'search_opened'
  | 'search_result_selected'
  | 'share_created'
  | 'track_like'
  | 'track_unlike'
  | 'vk_import_completed'
  | 'vk_import_started'
  | 'yandex_connect_completed'
  | 'yandex_connect_started'

type AnalyticsParams = Record<string, string | number | boolean>

declare global {
  interface Window {
    dataLayer?: unknown[]
    ym?: (...args: unknown[]) => void
  }
}

let installed = false
let lastPageUrl = typeof window === 'undefined' ? '' : window.location.href
let lastSection = ''

function callMetrika(...args: unknown[]) {
  if (typeof window === 'undefined' || typeof window.ym !== 'function') return
  window.ym(METRIKA_COUNTER_ID, ...args)
}

function absoluteUrl(value: string) {
  return new URL(value, window.location.href).toString()
}

export function trackPageView(url = window.location.href, title = document.title) {
  const nextUrl = absoluteUrl(url)
  if (nextUrl === lastPageUrl) return
  const referer = lastPageUrl || document.referrer
  lastPageUrl = nextUrl
  callMetrika('hit', nextUrl, { title, referer })
}

export function trackSection(section: string, title: string) {
  if (typeof window === 'undefined' || !section || section === lastSection) return
  const firstSection = !lastSection
  lastSection = section
  if (firstSection && section === 'home' && window.location.pathname === '/') return
  const url = new URL(window.location.href)
  url.searchParams.set('section', section)
  trackPageView(url.toString(), `${title} — XEDOC Play`)
}

export function trackGoal(goal: AnalyticsGoal, params: AnalyticsParams = {}) {
  callMetrika('reachGoal', goal, params)
}

export function installSpaPageTracking() {
  if (typeof window === 'undefined' || installed) return
  installed = true
  const notify = () => window.queueMicrotask(() => trackPageView())
  const pushState = window.history.pushState.bind(window.history)
  const replaceState = window.history.replaceState.bind(window.history)
  window.history.pushState = (...args) => {
    pushState(...args)
    notify()
  }
  window.history.replaceState = (...args) => {
    replaceState(...args)
    notify()
  }
  window.addEventListener('popstate', notify)
}
