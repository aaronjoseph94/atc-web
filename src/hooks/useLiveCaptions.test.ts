// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRadio, type Transmission } from '../live/radio/radioStore'
import { usePlayhead } from '../playback/playheadStore'
import { useLiveCaptions } from './useLiveCaptions'

const call = (id: string): Transmission => ({ id, stationId: 'jfk-twr', airport: 'JFK', at: Date.now(), durationMs: 2000, text: 'Delta 123, contact departure', status: 'done', speaker: 'controller', callsigns: [], icao24: null })

describe('useLiveCaptions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    usePlayhead.getState().setAirport('JFK')
    useRadio.setState({ on: true, status: 'live', caption: null })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fades a radio caption after a while', () => {
    const { unmount } = renderHook(() => useLiveCaptions())
    useRadio.getState().patch({ caption: call('a') })
    vi.advanceTimersByTime(10_000)
    expect(useRadio.getState().caption).toBeNull()
    unmount()
  })

  it('still fades the last caption when the radio is stopped while it shows', () => {
    const { unmount } = renderHook(() => useLiveCaptions())
    useRadio.getState().patch({ caption: call('b') })
    vi.advanceTimersByTime(1000)
    useRadio.getState().patch({ on: false, status: 'off' })
    vi.advanceTimersByTime(10_000)
    expect(useRadio.getState().caption).toBeNull()
    unmount()
  })
})
