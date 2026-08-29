export type GlobalTopRoute =
  | { kind: 'chart' }
  | { kind: 'releases' }
  | { kind: 'genre'; id: string }

export const GLOBAL_TOP_PATH = '/global-top'

export function parseGlobalTopRoute(pathname: string): GlobalTopRoute | null | undefined {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === GLOBAL_TOP_PATH) return null
  if (path === `${GLOBAL_TOP_PATH}/chart`) return { kind: 'chart' }
  if (path === `${GLOBAL_TOP_PATH}/releases`) return { kind: 'releases' }
  const genre = path.match(/^\/global-top\/genre\/([A-Za-z0-9_-]+)$/)
  if (genre) return { kind: 'genre', id: genre[1] }
  return undefined
}

export function isGlobalTopRoutePath(pathname: string) {
  return parseGlobalTopRoute(pathname) !== undefined
}

export function globalTopRoutePath(route?: GlobalTopRoute | null) {
  if (!route) return GLOBAL_TOP_PATH
  if (route.kind === 'genre') return `${GLOBAL_TOP_PATH}/genre/${route.id}`
  return `${GLOBAL_TOP_PATH}/${route.kind}`
}
