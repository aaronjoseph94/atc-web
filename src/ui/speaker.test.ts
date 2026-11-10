import { describe, expect, it } from 'vitest'
import { ATC_COLORS, PILOT_COLORS, speakerColors, speakerDirection } from './speaker'

describe('speaker colours', () => {
  it('pulses purple while ATC talks to the aircraft', () => {
    expect(speakerColors('controller')).toBe(ATC_COLORS)
    expect(ATC_COLORS.base.toUpperCase()).toBe('#7C5CFC')
  })

  it('pulses blue while the aircraft talks to ATC', () => {
    expect(speakerColors('pilot')).toBe(PILOT_COLORS)
    expect(PILOT_COLORS.base.toUpperCase()).toBe('#3B9BFF')
  })

  it('treats an unattributed call as ATC', () => {
    expect(speakerColors(null)).toBe(ATC_COLORS)
    expect(speakerColors(undefined)).toBe(ATC_COLORS)
  })

  it('ripples from the tower for ATC and from the aircraft for the pilot', () => {
    expect(speakerDirection('controller')).toBe('to-aircraft')
    expect(speakerDirection(null)).toBe('to-aircraft')
    expect(speakerDirection('pilot')).toBe('to-tower')
  })
})
