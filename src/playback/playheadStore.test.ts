import { beforeEach, describe, expect, it } from 'vitest'
import type { ClipPack } from '../api/types'
import { useSettings } from '../settings/settingsStore'
import { playbackInstant, usePlayhead } from './playheadStore'

const clip: ClipPack = {
  id: 'ord-tower-demo',
  stationId: 'ord-tower-28r',
  audioUrl: '/clips/ord-tower-demo/audio.wav',
  durationMs: 8000,
  title: 'ORD Tower demo',
  cues: [],
  tracks: {},
}

describe('playhead store', () => {
  beforeEach(() => {
    usePlayhead.getState().setAirport('LAX')
    usePlayhead.getState().exitPlayback()
  })

  it('starts live at the configured airport with its first station', () => {
    const s = usePlayhead.getState()
    expect(s.mode).toBe('live')
    expect(s.airportIcao).toBe('LAX')
    expect(s.stationId).toMatch(/^lax-twr-/)
  })

  it('keeps the camera manual across airports and replays when Automatic camera is off', () => {
    useSettings.getState().update('autoCamera', false)
    try {
      usePlayhead.getState().setAirport('JFK')
      expect(usePlayhead.getState().cameraMode).toBe('manual')
      usePlayhead.getState().enterPlayback(clip)
      expect(usePlayhead.getState().cameraMode).toBe('auto')
      usePlayhead.getState().exitPlayback()
      expect(usePlayhead.getState().cameraMode).toBe('manual')
    } finally {
      useSettings.getState().update('autoCamera', true)
    }
    usePlayhead.getState().setAirport('ORD')
    expect(usePlayhead.getState().cameraMode).toBe('auto')
  })

  it('setAirport resets selection, playback and panels', () => {
    const s = usePlayhead.getState()
    s.select('abc')
    s.setPanel('menu')
    expect(usePlayhead.getState()).toMatchObject({ sheet: 'card', following: true })
    s.setAirport('yyz')
    const n = usePlayhead.getState()
    expect(n.airportIcao).toBe('YYZ')
    expect(n.selectedIcao).toBeNull()
    expect(n.sheet).toBe('closed')
    expect(n.following).toBe(false)
    expect(n.panel).toBeNull()
    expect(n.mode).toBe('live')
    expect(n.liveStatus).toBe('loading')
  })

  it('enterPlayback jumps to the clip airport and starts playing', () => {
    usePlayhead.getState().enterPlayback(clip)
    const s = usePlayhead.getState()
    expect(s.mode).toBe('playback')
    expect(s.playing).toBe(true)
    expect(s.tMs).toBe(0)
    expect(s.airportIcao).toBe('ORD')
    // The clip's hand-written station id resolves to the real per-runway tower.
    expect(s.stationId).toMatch(/^ord-twr-.*28r/)
  })

  it('select() opens the card and locks the camera; clearing lets go', () => {
    const s = usePlayhead.getState()
    s.select('abc')
    s.setSheet('full')
    s.select('def')
    // Switching aircraft while the full view is open keeps it open.
    expect(usePlayhead.getState()).toMatchObject({ selectedIcao: 'def', sheet: 'full', following: true })
    s.select(null)
    expect(usePlayhead.getState()).toMatchObject({ selectedIcao: null, sheet: 'closed', following: false })
  })

  it('keeps the tower log newest first and bounded', () => {
    const ev = (i: number) => ({ id: `e${i}`, at: i, kind: 'landed' as const, icao24: 'a', callsign: 'A', runway: '28R', text: 't', lon: 0, lat: 0 })
    usePlayhead.getState().addEvents([ev(1), ev(2)])
    usePlayhead.getState().addEvents([ev(3)])
    expect(usePlayhead.getState().events.map((e) => e.id)).toEqual(['e3', 'e2', 'e1'])
    usePlayhead.getState().addEvents(Array.from({ length: 200 }, (_, i) => ev(100 + i)))
    expect(usePlayhead.getState().events).toHaveLength(120)
    expect(usePlayhead.getState().events[0].id).toBe('e299')
  })

  it('advances replay time by the playback rate', () => {
    usePlayhead.getState().enterPlayback({ ...clip, durationMs: 600_000 })
    usePlayhead.getState().setRate(4)
    const s = usePlayhead.getState()
    expect(playbackInstant({ ...s, tMs: 1000, tSyncedAt: performance.now() - 500 })).toBeGreaterThanOrEqual(2990)
    expect(playbackInstant({ ...s, playing: false, tMs: 1000 })).toBe(1000)
  })

  it('exitPlayback returns to live and clears transient state', () => {
    usePlayhead.getState().enterPlayback(clip)
    usePlayhead.getState().setTMs(4000)
    usePlayhead.getState().setActive('ual2099', 'controller')
    usePlayhead.getState().exitPlayback()
    const s = usePlayhead.getState()
    expect(s.mode).toBe('live')
    expect(s.playing).toBe(false)
    expect(s.tMs).toBe(0)
    expect(s.activeCallsign).toBeNull()
  })

  it('returns to the airport and channel you were on after a replay elsewhere', () => {
    usePlayhead.getState().setAirport('YYZ')
    const before = usePlayhead.getState().stationId
    usePlayhead.getState().enterPlayback(clip) // an ORD scene
    usePlayhead.getState().enterPlayback({ ...clip, id: 'second' }) // scene to scene keeps the origin
    expect(usePlayhead.getState().airportIcao).toBe('ORD')
    usePlayhead.getState().exitPlayback()
    expect(usePlayhead.getState()).toMatchObject({ airportIcao: 'YYZ', stationId: before, mode: 'live', returnTo: null })
  })

  it('setLive tracks status, count and last-updated timestamp', () => {
    usePlayhead.getState().setLive('ok', 42)
    const s = usePlayhead.getState()
    expect(s.liveStatus).toBe('ok')
    expect(s.liveCount).toBe(42)
    expect(s.liveUpdatedAt).toBeTypeOf('number')
    usePlayhead.getState().setLive('error')
    expect(usePlayhead.getState().liveCount).toBe(42) // preserved
  })
})
