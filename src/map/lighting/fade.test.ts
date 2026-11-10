import { describe, expect, it } from 'vitest'
import { FADE_MS, fadeDone, fadeValue, startFade } from './fade'

describe('fade', () => {
  it('runs a full day-to-night change over two seconds, eased', () => {
    const f = startFade(0, 1, 1000)
    expect(f.duration).toBe(FADE_MS)
    expect(fadeValue(f, 1000)).toBe(0)
    expect(fadeValue(f, 1000 + FADE_MS / 2)).toBeCloseTo(0.5, 5)
    // Eased: slow at the start.
    expect(fadeValue(f, 1000 + FADE_MS / 10)).toBeLessThan(0.1)
    expect(fadeValue(f, 1000 + FADE_MS)).toBe(1)
    expect(fadeDone(f, 1000 + FADE_MS)).toBe(true)
    expect(fadeDone(f, 1000 + FADE_MS - 1)).toBe(false)
  })

  it('takes less time for small steps, but not none', () => {
    expect(startFade(0.4, 0.45, 0).duration).toBe(FADE_MS * 0.3)
    expect(startFade(0.2, 0.8, 0).duration).toBeCloseTo(FADE_MS * 0.6, 5)
    expect(startFade(0.5, 0.5, 0).duration).toBe(0)
  })

  it('restarts from wherever it has got to', () => {
    const f = startFade(0, 1, 0)
    const mid = fadeValue(f, 500)
    const back = startFade(mid, 0, 500)
    expect(fadeValue(back, 500)).toBeCloseTo(mid, 10)
    expect(fadeValue(back, 500 + back.duration)).toBe(0)
  })
})
