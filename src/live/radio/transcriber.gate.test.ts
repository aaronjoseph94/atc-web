/* oxlint-disable no-await-in-loop -- the steps in these tests happen one after another on purpose */
/**
 * The whole path from a transcript to a published call, with `/api/ai`
 * answered by hand: a call is not logged, captioned or highlighted until the
 * AI pass has answered, or the wait is over, or AI is known to be unavailable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiSettings } from '../../ai/aiSettings'
import { resetAiLimits } from '../../ai/client'
import { usePlayhead } from '../../playback/playheadStore'

vi.mock('./player', () => ({ onSegment: () => () => {} }))

const { AI_WAIT_MS, ingest } = await import('./transcriber')
const { useRadio } = await import('./radioStore')
const { useUnderstanding } = await import('./understand/store')
const { resetUnderstandingForTests } = await import('./understand/understand')

const ON = { configured: true, provider: 'anthropic', model: 'm', label: 'M', usage: { day: '2026-11-12', today: 0, cap: 3000, limited: false, resetsAt: '2026-11-13T00:00:00.000Z', tasks: {}, storage: 'memory' } }
const NOT_SET_UP = { ...ON, configured: false, provider: null, model: null, label: null }

const cleanup = (cleaned: string, speaker: 'atc' | 'pilot' = 'pilot') => ({ cleaned, plain: 'Explained.', speaker, speakerConfidence: 0.95, callsigns: [], instructions: [] })

describe('ingest: calls are shown after the AI pass', () => {
  let status: unknown
  /** Requests to the AI task, by the call's text, each answered when the test says. */
  let pending: Map<string, (res: Response) => void>
  let asked: string[]
  let n = 0

  const stationId = () => usePlayhead.getState().stationId
  const log = () => useRadio.getState().log[stationId()] ?? []
  // An approach channel: no taxiway network is fetched for the request's context.
  const say = (text: string) => ingest(text, { stationId: stationId(), airport: 'JFK', kind: 'APP', endedAt: Date.now() + n++, durationMs: 2000 })
  const flush = async () => {
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0)
  }
  const answer = async (text: string, result: unknown, statusCode = 200) => {
    const body = statusCode === 200 ? { ok: true, task: 'radioCleanup', provider: 'anthropic', model: 'm', result } : result
    pending.get(text)!(new Response(JSON.stringify(body), { status: statusCode }))
    await flush()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    status = ON
    pending = new Map()
    asked = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url !== '/api/ai') return new Response('{}', { status: 404 })
        if (!init?.method || init.method === 'GET') return new Response(JSON.stringify(status))
        const text = (JSON.parse(String(init.body)) as { input: { text: string } }).input.text
        asked.push(text)
        return new Promise<Response>((resolve) => pending.set(text, resolve))
      }),
    )
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    resetUnderstandingForTests()
    resetAiLimits()
    useAiSettings.setState({ enabled: true })
    usePlayhead.getState().setAirport('JFK')
    usePlayhead.setState({ mode: 'live' })
    useRadio.setState({ log: {}, caption: null, focus: null, pending: 0 })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('publishes nothing until the answer arrives, then the cleaned call with the AI’s speaker', async () => {
    const raw = 'delta four five six descend and maintain three thousand'
    say(raw)
    await flush()
    expect(asked).toEqual([raw])
    expect(log()).toEqual([])
    expect(useRadio.getState().caption).toBeNull()
    // Held calls keep the caption line's "Transcribing" state alive.
    expect(useRadio.getState().pending).toBe(1)

    await vi.advanceTimersByTimeAsync(3000)
    expect(log()).toEqual([])
    await answer(raw, cleanup('Delta 456, descend and maintain 3,000.', 'atc'))

    expect(log()).toHaveLength(1)
    expect(log()[0]).toMatchObject({ text: 'Delta 456, descend and maintain 3,000.', raw, speaker: 'controller' })
    expect(log()[0].unprocessed).toBeUndefined()
    expect(useRadio.getState().caption?.text).toBe('Delta 456, descend and maintain 3,000.')
    expect(useRadio.getState().pending).toBe(0)
    expect(useUnderstanding.getState().results[log()[0].id]?.plain).toBe('Explained.')
  })

  it('after about eight seconds shows the call as recognised, marked unprocessed; a late answer upgrades it in place', async () => {
    const raw = 'jetblue seven eight nine turn right heading zero nine zero'
    say(raw)
    await flush()
    await vi.advanceTimersByTimeAsync(AI_WAIT_MS - 1)
    expect(log()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(log()).toHaveLength(1)
    expect(log()[0]).toMatchObject({ text: raw, unprocessed: true })
    const id = log()[0].id

    await answer(raw, cleanup('JetBlue 789, turn right heading 090.', 'atc'))
    expect(log()).toHaveLength(1)
    expect(log()[0]).toMatchObject({ id, text: 'JetBlue 789, turn right heading 090.', raw, speaker: 'controller' })
    expect(log()[0].unprocessed).toBeUndefined()
    // The caption line follows the upgrade too.
    expect(useRadio.getState().caption?.text).toBe('JetBlue 789, turn right heading 090.')
  })

  it('keeps calls in the order they were heard, whichever answer comes first', async () => {
    const first = 'united one two three climb and maintain flight level two three zero'
    const second = 'climb and maintain flight level two three zero united one two three'
    say(first)
    say(second)
    await flush()
    expect(asked).toEqual([first, second])
    await answer(second, cleanup('Climb and maintain FL230, United 123.'))
    expect(log()).toEqual([])
    await answer(first, cleanup('United 123, climb and maintain FL230.', 'atc'))
    expect(log().map((t) => t.text)).toEqual(['United 123, climb and maintain FL230.', 'Climb and maintain FL230, United 123.'])
  })

  it('an earlier call that times out releases the answered one behind it', async () => {
    const first = 'american two two contact departure one two four point seven five'
    const second = 'over to departure american two two good day'
    say(first)
    await vi.advanceTimersByTimeAsync(2000)
    say(second)
    await flush()
    await answer(second, cleanup('Over to departure, American 22, good day.'))
    expect(log()).toEqual([])
    await vi.advanceTimersByTimeAsync(AI_WAIT_MS - 2000)
    expect(log().map((t) => [t.text, !!t.unprocessed])).toEqual([
      [first, true],
      ['Over to departure, American 22, good day.', false],
    ])
  })

  it('with AI not set up, nothing is sent and calls go out at once, marked', async () => {
    status = NOT_SET_UP
    // The very first call waits only for the status answer, not for the eight seconds.
    say('speedbird one seven heavy cleared to land runway two two left')
    await flush()
    expect(log()).toHaveLength(1)
    expect(log()[0]).toMatchObject({ unprocessed: true })
    expect(useUnderstanding.getState().ai).toBe('off')
    // From then on: synchronously.
    say('cleared to land two two left speedbird one seven heavy')
    expect(log()).toHaveLength(2)
    expect(log()[1]).toMatchObject({ unprocessed: true })
    expect(asked).toEqual([])
  })

  it('with AI switched off on this device, calls go out at once and nothing is asked, not even the status', async () => {
    useAiSettings.setState({ enabled: false })
    say('emirates two zero one descend to four thousand')
    expect(log()).toHaveLength(1)
    expect(log()[0]).toMatchObject({ unprocessed: true })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('when the daily limit is reached, waiting calls are let go and later ones skip the wait', async () => {
    const a = 'air canada five five descend and maintain six thousand'
    const b = 'down to six thousand air canada five five'
    say(a)
    say(b)
    await flush()
    expect(asked).toEqual([a, b])
    await answer(a, { ok: false, task: 'radioCleanup', error: 'AI daily limit reached', status: 429, code: 'daily_cap', retryAfterS: 3600 }, 429)
    expect(log().map((t) => [t.text, t.unprocessed])).toEqual([
      [a, true],
      [b, true],
    ])
    expect(useUnderstanding.getState().ai).toBe('limited')
    say('air canada five five contact new york approach')
    expect(log()).toHaveLength(3)
    expect(log()[2]).toMatchObject({ unprocessed: true })
    expect(asked).toHaveLength(2)
  })

  it('a failed request shows the call at once rather than waiting out the clock', async () => {
    const raw = 'cactus nine nine say again the altimeter'
    say(raw)
    await flush()
    await answer(raw, { ok: false, error: 'AI request failed', status: 500 }, 500)
    expect(log()).toHaveLength(1)
    expect(log()[0]).toMatchObject({ text: raw, unprocessed: true })
  })

  it('a one-word call has nothing to process: shown at once and not marked', async () => {
    await flush()
    say('Roger.')
    expect(log()).toHaveLength(1)
    expect(log()[0].unprocessed).toBeUndefined()
    expect(asked).toEqual([])
  })

  it('an answer that rejects the cleaned text still counts as processed (speaker kept, words as heard)', async () => {
    const raw = 'skywest three four taxi to the ramp'
    say(raw)
    await flush()
    // The "cleaned" text is a different call altogether, so it is not used.
    await answer(raw, cleanup('Cleared for takeoff runway 31 left, wind calm.', 'pilot'))
    expect(log()[0]).toMatchObject({ text: raw, speaker: 'pilot' })
    expect(log()[0].raw).toBeUndefined()
    expect(log()[0].unprocessed).toBeUndefined()
  })
})
