import { describe, expect, it } from 'vitest'
import { globalTopRoutePath, isGlobalTopRoutePath, parseGlobalTopRoute } from './globalTopRoutes'

describe('global top routes', () => {
  it('recognizes the overview and every shareable rubric path', () => {
    expect(parseGlobalTopRoute('/global-top')).toBeNull()
    expect(parseGlobalTopRoute('/global-top/chart')).toEqual({ kind: 'chart' })
    expect(parseGlobalTopRoute('/global-top/releases/')).toEqual({ kind: 'releases' })
    expect(parseGlobalTopRoute('/global-top/genre/rusrock')).toEqual({ kind: 'genre', id: 'rusrock' })
    expect(isGlobalTopRoutePath('/global-top/genre/heavy-hardcore')).toBe(true)
    expect(isGlobalTopRoutePath('/global-top/unknown')).toBe(false)
  })

  it('builds stable links for rubrics', () => {
    expect(globalTopRoutePath()).toBe('/global-top')
    expect(globalTopRoutePath({ kind: 'chart' })).toBe('/global-top/chart')
    expect(globalTopRoutePath({ kind: 'releases' })).toBe('/global-top/releases')
    expect(globalTopRoutePath({ kind: 'genre', id: 'ambient' })).toBe('/global-top/genre/ambient')
  })
})
