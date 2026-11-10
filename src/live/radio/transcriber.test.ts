import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RadioFeed } from '../../api/radioFeeds'
import { usePlayhead } from '../../playback/playheadStore'
import type { Segment } from './segmenter'

// Capture the segment listener the transcriber registers, instead of running the real player.
const listeners: ((seg: Segment, feed: RadioFeed, endedAt: number) => void)[] = []
vi.mock('./player', () => ({
  onSegment: (fn: (seg: Segment, feed: RadioFeed, endedAt: number) => void) => {
    listeners.push(fn)
    return () => listeners.splice(listeners.indexOf(fn), 1)
  },
}))

const { startTranscriber } = await import('./transcriber')
const { useRadio } = await import('./radioStore')

const feed: RadioFeed = { mount: 'kjfk_twr', name: 'KJFK Tower 119.1', kinds: ['TWR'], mhz: [119.1] }
const seg: Segment = { samples: new Float32Array(8000), sampleRate: 8000, startS: 0, durationMs: 1000, cut: false }

describe('startTranscriber', () => {
  let stop: () => void
  const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    fetchMock.mockClear()
    useRadio.setState({ transcripts: 'idle', pending: 0 })
    usePlayhead.getState().setAirport('JFK')
    stop = startTranscriber()
  })
  afterEach(() => {
    stop()
    vi.unstubAllGlobals()
  })

  it('sends a call heard live', () => {
    listeners[0](seg, feed, Date.now())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('drops the tail cut off when a replay starts, which the playhead would file under the replay’s channel', () => {
    usePlayhead.setState({ mode: 'playback', airportIcao: 'ORD', stationId: 'ord-twr-rwy-10l-28r-132700' })
    listeners[0](seg, feed, Date.now())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useRadio.getState().pending).toBe(0)
  })
})
