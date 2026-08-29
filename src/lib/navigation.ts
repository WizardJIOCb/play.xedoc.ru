import { isGlobalTopRoutePath } from './globalTopRoutes'

export const APP_NAVIGATE_EVENT = 'xedoc:app-navigate'

const appPathPattern = /^(?:\/(?:feed|friends|genres|liked|recommendations|top|admin|search)\/?|\/users\/[A-Za-z0-9_.-]{3,32}\/?|\/share\/[A-Za-z0-9_-]{20,80}\/?|\/)$/

export function isAppPath(pathname: string) {
  return appPathPattern.test(pathname) || isGlobalTopRoutePath(pathname)
}

export function navigateApp(href: string | URL, replace = false) {
  const url = href instanceof URL ? href : new URL(href, window.location.href)
  if (url.origin !== window.location.origin || !isAppPath(url.pathname)) return false

  const nextLocation = `${url.pathname}${url.search}${url.hash}`
  const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (nextLocation !== currentLocation) {
    window.history[replace ? 'replaceState' : 'pushState'](null, '', nextLocation)
  }
  window.dispatchEvent(new Event(APP_NAVIGATE_EVENT))
  return true
}

export function installAppLinkNavigation() {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target
    if (!(target instanceof Element)) return
    const link = target.closest<HTMLAnchorElement>('a[href]')
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return

    const url = new URL(link.href, window.location.href)
    if (url.origin !== window.location.origin || !isAppPath(url.pathname)) return
    event.preventDefault()
    navigateApp(url)
  }

  document.addEventListener('click', onClick)
  return () => document.removeEventListener('click', onClick)
}
