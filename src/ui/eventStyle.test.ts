import { PlaneLanding, PlaneTakeoff, TowerControl } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { RUNWAY_USE_COLOR } from '../map/mapStyle'
import { eventStyle } from './eventStyle'

describe('eventStyle', () => {
  it('matches the map: landings green, takeoffs blue', () => {
    expect(eventStyle('landed')).toMatchObject({ icon: PlaneLanding, color: RUNWAY_USE_COLOR.arrivals })
    expect(eventStyle('departed')).toMatchObject({ icon: PlaneTakeoff, color: RUNWAY_USE_COLOR.departures })
  })
  it('keeps emergencies solid and gives every kind its own colour', () => {
    expect(eventStyle('emergency').solid).toBe(true)
    const colours = ['landed', 'departed', 'goaround', 'lineup', 'emergency'].map((k) => eventStyle(k).color)
    expect(new Set(colours).size).toBe(colours.length)
  })
  it('falls back to a neutral badge', () => {
    expect(eventStyle('something-new').icon).toBe(TowerControl)
    expect(eventStyle(undefined).icon).toBe(TowerControl)
  })
})
