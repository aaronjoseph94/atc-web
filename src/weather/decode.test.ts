import { describe, expect, it } from 'vitest'
import { agoText, compassPoint, conditionsLine, densityAltitudeFt, describeSky, describeWeather, flightCategory, formatVisibility, reportsHpa, speedValue, toHpa, variableRange } from './decode'

describe('describeWeather', () => {
  it('reads present-weather groups as words', () => {
    expect(describeWeather('-RA BR')).toBe('Light rain and mist')
    expect(describeWeather('+TSRA')).toBe('Heavy thunderstorm with rain')
    expect(describeWeather('-SHSN')).toBe('Light snow showers')
    expect(describeWeather('FZFG')).toBe('Freezing fog')
    expect(describeWeather('VCSH')).toBe('Showers nearby')
    expect(describeWeather('-DZ BR HZ')).toBe('Light drizzle, mist and haze')
    expect(describeWeather(null)).toBeNull()
    expect(describeWeather('$')).toBeNull()
  })
})

describe('describeSky and conditionsLine', () => {
  it('names the ceiling, else the lowest layer, else clear', () => {
    expect(describeSky([{ cover: 'FEW', baseFt: 3700 }, { cover: 'BKN', baseFt: 16000 }])).toBe('Broken clouds at 16,000 ft')
    expect(describeSky([{ cover: 'SCT', baseFt: 4600 }, { cover: 'SCT', baseFt: 25000 }])).toBe('Scattered clouds at 4,600 ft')
    expect(describeSky([{ cover: 'CLR', baseFt: null }])).toBe('Clear skies')
    expect(describeSky([])).toBe('No cloud reported')
    expect(describeSky([{ cover: 'OVC', baseFt: 1200 }], 'm')).toBe('Overcast at 370 m')
  })
  it('puts weather first, then the sky', () => {
    expect(conditionsLine({ weather: '-RA', clouds: [{ cover: 'OVC', baseFt: 1200 }] })).toBe('Light rain, overcast at 1,200 ft')
    expect(conditionsLine({ weather: null, clouds: [{ cover: 'FEW', baseFt: 5000 }] })).toBe('Few clouds at 5,000 ft')
    expect(conditionsLine({ weather: 'BR', clouds: [] })).toBe('Mist')
  })
})

describe('numbers', () => {
  it('flight category thresholds', () => {
    expect(flightCategory(null, 10)).toBe('VFR')
    expect(flightCategory(3000, 10)).toBe('MVFR')
    expect(flightCategory(800, 10)).toBe('IFR')
    expect(flightCategory(5000, 0.5)).toBe('LIFR')
    expect(flightCategory(null, null)).toBeNull()
  })
  it('observation age', () => {
    expect(agoText(20_000)).toBe('just now')
    expect(agoText(6 * 60_000)).toBe('6 min ago')
    expect(agoText(80 * 60_000)).toBe('1 h 20 min ago')
    expect(agoText(120 * 60_000)).toBe('2 h ago')
  })
  it('variable wind range, ignoring remarks', () => {
    expect(variableRange('KJFK 101451Z 25011KT 220V280 10SM')).toEqual([220, 280])
    expect(variableRange('KJFK 101451Z 25011KT 10SM RMK 200V300')).toBeNull()
  })
  it('visibility in miles or kilometres', () => {
    expect(formatVisibility(10, true)).toBe('10+ mi')
    expect(formatVisibility(0.75, false)).toBe('3/4 mi')
    expect(formatVisibility(1.5, false)).toBe('1 1/2 mi')
    expect(formatVisibility(2.5, false)).toBe('2 1/2 mi')
    expect(formatVisibility(6.2, true, 'm')).toBe('10+ km')
    expect(formatVisibility(0.5, false, 'm')).toBe('805 m')
    expect(formatVisibility(null, false)).toBe('—')
  })
  it('density altitude, pressure, units', () => {
    // Standard day at sea level: density altitude is sea level.
    expect(densityAltitudeFt(0, 15, 29.92)).toBe(0)
    // Denver on a hot day.
    expect(densityAltitudeFt(5434, 32, 30.1)).toBeGreaterThan(8500)
    expect(densityAltitudeFt(0, null, 29.92)).toBeNull()
    expect(toHpa(29.92)).toBe(1013)
    expect(reportsHpa('EGLL 101450Z 25011KT 9999 Q1013')).toBe(true)
    expect(reportsHpa('KJFK 101451Z A2998 RMK Q1015')).toBe(false)
    expect(speedValue(10, 'kmh')).toBe(19)
    expect(compassPoint(250)).toBe('west-southwest')
    expect(compassPoint(359)).toBe('north')
  })
})
