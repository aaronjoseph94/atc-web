import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, formatAltitude, formatSpeed, formatVerticalRate, useSettings } from './settingsStore'

describe('settings store', () => {
  beforeEach(() => useSettings.getState().reset())

  it('starts with defaults', () => {
    const s = useSettings.getState()
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      expect(s[k as keyof typeof DEFAULT_SETTINGS]).toEqual(v)
    }
  })

  it('update() changes one key and reset() restores it', () => {
    useSettings.getState().update('pollSeconds', 15)
    useSettings.getState().update('mapTheme', 'graphite')
    expect(useSettings.getState().pollSeconds).toBe(15)
    expect(useSettings.getState().mapTheme).toBe('graphite')
    useSettings.getState().reset()
    expect(useSettings.getState().pollSeconds).toBe(8)
    expect(useSettings.getState().mapTheme).toBe('navy')
  })
})

describe('unit formatting', () => {
  it('formats altitude', () => {
    expect(formatAltitude(null, 'ft')).toBe('—')
    expect(formatAltitude(1000, 'ft')).toBe('1,000 ft')
    expect(formatAltitude(1000, 'm')).toBe('305 m')
  })

  it('formats speed', () => {
    expect(formatSpeed(undefined, 'kt')).toBe('—')
    expect(formatSpeed(100, 'kt')).toBe('100 kt')
    expect(formatSpeed(100, 'kmh')).toBe('185 km/h')
    expect(formatSpeed(100, 'mph')).toBe('115 mph')
  })

  it('formats vertical rate with sign', () => {
    expect(formatVerticalRate(null, 'ft')).toBe('—')
    expect(formatVerticalRate(1500, 'ft')).toBe('+1,500 fpm')
    expect(formatVerticalRate(-800, 'ft')).toBe('-800 fpm')
    expect(formatVerticalRate(1000, 'm')).toBe('+5.1 m/s')
  })
})
