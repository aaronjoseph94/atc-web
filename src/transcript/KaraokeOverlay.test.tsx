// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ClipPack } from '../api/types'
import { usePlayhead } from '../playback/playheadStore'
import { KaraokeOverlay } from './KaraokeOverlay'

const clip: ClipPack = {
  id: 'ord-tower-demo',
  stationId: 'ord-tower-28r',
  audioUrl: '/a.wav',
  durationMs: 4000,
  title: 't',
  cues: [{ id: 'c1', startMs: 0, endMs: 2000, text: 'one two three four', callsign: 'UAL1', speaker: 'Tower' }],
  tracks: {},
}

describe('<KaraokeOverlay />', () => {
  beforeEach(() => usePlayhead.getState().exitPlayback())
  afterEach(cleanup)

  it('renders nothing in live mode', () => {
    const { container } = render(<KaraokeOverlay />)
    expect(container.innerHTML).toBe('')
  })

  it('lights up spoken words proportionally to the playhead', () => {
    usePlayhead.getState().enterPlayback(clip)
    usePlayhead.getState().setTMs(1000) // 50% → 2 of 4 words
    render(<KaraokeOverlay />)
    expect(screen.getByText('Tower · UAL1')).toBeTruthy()
    const spoken = ['one', 'two'].map((w) => screen.getByText(w).className)
    const rest = ['three', 'four'].map((w) => screen.getByText(w).className)
    expect(spoken.every((c) => c.includes('text-white') && !c.includes('text-white/45'))).toBe(true)
    expect(rest.every((c) => c.includes('text-white/45'))).toBe(true)
  })

  it('shows a waiting message between cues', () => {
    usePlayhead.getState().enterPlayback(clip)
    usePlayhead.getState().setTMs(3000)
    render(<KaraokeOverlay />)
    expect(screen.getByText('Waiting for the next transmission…')).toBeTruthy()
  })
})
