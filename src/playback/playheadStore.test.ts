import { beforeEach, describe, expect, it } from 'vitest'
import type { ClipPack } from '../api/types'
import { usePlayhead } from './playheadStore'

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
    expect(s.stationId).toBe('lax-tower-n')
  })

  it('setAirport resets selection, playback and panels', () => {
    const s = usePlayhead.getState()
    s.setSelectedIcao('abc')
    s.setSheetOpen(true)
    s.setPanel('menu')
    s.setAirport('yyz')
    const n = usePlayhead.getState()
    expect(n.airportIcao).toBe('YYZ')
    expect(n.selectedIcao).toBeNull()
    expect(n.sheetOpen).toBe(false)
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
    expect(s.stationId).toBe('ord-tower-28r')
  })

  it('exitPlayback returns to live and clears transient state', () => {
    usePlayhead.getState().enterPlayback(clip)
    usePlayhead.getState().setTMs(4000)
    usePlayhead.getState().setActiveCallsign('UAL2099')
    usePlayhead.getState().exitPlayback()
    const s = usePlayhead.getState()
    expect(s.mode).toBe('live')
    expect(s.playing).toBe(false)
    expect(s.tMs).toBe(0)
    expect(s.activeCallsign).toBeNull()
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
