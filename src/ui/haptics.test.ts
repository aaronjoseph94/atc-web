import { describe, expect, it } from 'vitest'
import { isIosHaptic, supportsHaptics } from './haptics'
import { tickAt, TICK_MS } from './tick'
import { callNames } from './useHapticFeedback'

const iphone = (v: string) => ({ vibrate: false, userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v.split('_')[0]}.0 Mobile/15E148 Safari/604.1`, platform: 'iPhone', maxTouchPoints: 5 })

describe('haptics', () => {
  it('uses the vibration motor on touch phones that have one', () => {
    expect(supportsHaptics({ vibrate: true, userAgent: 'Android', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(true)
  })

  it('does not offer haptics on desktop browsers, vibrate API or not', () => {
    expect(supportsHaptics({ vibrate: true, userAgent: 'Chrome', platform: 'Win32', maxTouchPoints: 0 })).toBe(false)
    expect(supportsHaptics({ vibrate: false, userAgent: 'Safari', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
  })

  it('uses the switch tick from iOS 18 on, iPads included', () => {
    expect(isIosHaptic(iphone('18_1'))).toBe(true)
    expect(isIosHaptic(iphone('26_0'))).toBe(true)
    expect(isIosHaptic(iphone('17_5'))).toBe(false)
    expect(supportsHaptics(iphone('17_5'))).toBe(false)
    expect(isIosHaptic({ vibrate: false, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
  })

  it('knows when a call names the watched flight', () => {
    const call = { icao24: null, callsigns: [{ callsign: 'KLM678', icao24: 'abc123', confidence: 1 }] }
    expect(callNames(call, 'abc123')).toBe(true)
    expect(callNames({ icao24: 'abc123', callsigns: [] }, 'abc123')).toBe(true)
    expect(callNames(call, 'def456')).toBe(false)
  })
})

describe('number ticker', () => {
  it('rolls from the old value to the new one, fast then settling', () => {
    expect(tickAt(1000, 2000, 0)).toBe(1000)
    expect(tickAt(1000, 2000, TICK_MS)).toBe(2000)
    expect(tickAt(1000, 2000, TICK_MS * 2)).toBe(2000)
    const half = tickAt(1000, 2000, TICK_MS / 2)
    // Ease-out: more than half way at half time.
    expect(half).toBeGreaterThan(1500)
    expect(half).toBeLessThan(2000)
    expect(tickAt(-800, 600, TICK_MS / 2)).toBeGreaterThan(-100)
  })
})
