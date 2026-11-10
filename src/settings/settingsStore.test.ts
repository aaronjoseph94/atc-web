import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, formatAltitude, formatSpeed, formatVerticalRate, restoreSettings, useSettings } from './settingsStore'

describe('settings store', () => {
  beforeEach(() => useSettings.getState().reset())

  it('starts with defaults', () => {
    const s = useSettings.getState()
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      expect(s[k as keyof typeof DEFAULT_SETTINGS]).toEqual(v)
    }
  })

  it('update() changes one key and reset() restores it', () => {
    useSettings.getState().update('labels', 'always')
    useSettings.getState().update('pollSeconds', 15)
    expect(useSettings.getState().labels).toBe('always')
    expect(useSettings.getState().pollSeconds).toBe(15)
    useSettings.getState().reset()
    expect(useSettings.getState().labels).toBe('auto')
    expect(useSettings.getState().pollSeconds).toBe(5)
  })
})

describe('restoreSettings', () => {
  it('keeps known keys with the right kind of value', () => {
    expect(restoreSettings({ labels: 'always', pollSeconds: 15, favourites: ['JFK'] })).toEqual({ labels: 'always', pollSeconds: 15, favourites: ['JFK'] })
  })

  it('drops options that no longer exist, and values of the wrong type', () => {
    expect(restoreSettings({ tilt: true, buildings3d: true, trails: 'yes', favourites: 'JFK', hideGround: true })).toEqual({ hideGround: true })
  })

  it('copes with nothing stored', () => {
    expect(restoreSettings(undefined)).toEqual({})
    expect(restoreSettings('garbage')).toEqual({})
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
