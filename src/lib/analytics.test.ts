import { beforeEach, describe, expect, it, vi } from 'vitest'
import { METRIKA_COUNTER_ID, trackGoal, trackPageView, trackSection } from './analytics'

describe('Yandex Metrika analytics', () => {
  const ym = vi.fn()

  beforeEach(() => {
    ym.mockReset()
    window.ym = ym
  })

  it('sends product goals with aggregate parameters', () => {
    trackGoal('music_play', { source: 'playlist', queueSize: 12 })
    expect(ym).toHaveBeenCalledWith(
      METRIKA_COUNTER_ID,
      'reachGoal',
      'music_play',
      { source: 'playlist', queueSize: 12 },
    )
  })

  it('deduplicates page views and reports virtual app sections', () => {
    trackPageView(window.location.href)
    expect(ym).not.toHaveBeenCalled()

    trackSection('library', 'Ваша библиотека')
    expect(ym).toHaveBeenCalledWith(
      METRIKA_COUNTER_ID,
      'hit',
      expect.stringContaining('section=library'),
      expect.objectContaining({ title: 'Ваша библиотека — XEDOC Play' }),
    )
  })
})
