/**
 * The AI pass over live radio calls. A transcribed call is held back (see
 * ../gate.ts and ../transcriber.ts) while the `radioCleanup` task is asked
 * (one request per call, two at a time) for a cleaned version, a plain
 * English line, the speaker and the instructions. The call is then published
 * with the answer already in it: the cleaned words, a confident speaker in
 * place of the rules' guess, an aircraft the raw words missed, and a taxi
 * clearance the raw words garbled gets its route.
 *
 * When AI cannot answer (not set up, switched off, over the daily cap) no
 * request is made and the call is not held: it is published as recognised,
 * marked unprocessed. An answer that arrives after its call was published
 * without it (it took too long) is folded into the call where it stands.
 */
import { aiBlocked, askAi, AiUnavailableError, getAiRunStatus, resetAiLimits, statusAllows } from '../../../ai/client'
import { useAiSettings } from '../../../ai/aiSettings'
import type { RadioCleanupResult } from '../../../api/ai/tasks/radioCleanup'
import { usePlayhead } from '../../../playback/playheadStore'
import { liveBuffer } from '../../session'
import { parseTaxi } from '../../taxi/parse'
import { showTaxiRoute } from '../../taxi/watch'
import { useRadio, type HeardCallsign, type Transmission } from '../radioStore'
import { gatherInput, runwayIdents } from './context'
import { createQueue, hiddenTracker } from './queue'
import { parseCleanup, type Understanding } from './result'
import { putResult, setPending, useUnderstanding, type AiState, type StoredUnderstanding } from './store'
import { callAircraftIds } from './threads'

const TASK = 'radioCleanup'
/** Hidden this long, the page stops asking (the radio may still play in a background tab). */
const HIDDEN_MS = 45_000
/** A call older than this when its turn comes is not worth cleaning any more. */
const STALE_MS = 3 * 60_000
const REQUEST_TIMEOUT_MS = 30_000
/** After this many failures in a row, wait before asking again. */
const FAILS_BEFORE_PAUSE = 3
const PAUSE_MS = 60_000
/** How long an answer about whether AI is available is trusted. */
const STATUS_FRESH_MS = 5 * 60_000

let statusChecked = 0
let statusPromise: Promise<void> | null = null
let failures = 0
let pausedUntil = 0

const setAi = (ai: AiState) => {
  if (useUnderstanding.getState().ai !== ai) useUnderstanding.setState({ ai })
}

/** Work out (once in a while) whether AI can answer: switched on here, set up on the server, under the daily cap. */
export function checkAi(force = false): Promise<void> {
  if (!useAiSettings.getState().enabled) {
    setAi('off')
    return Promise.resolve()
  }
  // A cap the server reported on an earlier request stands until it says otherwise.
  const blocked = aiBlocked(TASK)
  if (blocked && (blocked.code === 'daily_cap' || blocked.code === 'task_cap')) {
    setAi('limited')
    return Promise.resolve()
  }
  if (!force && (statusPromise || Date.now() - statusChecked < STATUS_FRESH_MS)) return statusPromise ?? Promise.resolve()
  statusChecked = Date.now()
  const p = getAiRunStatus()
    .then((st) => setAi(!st.configured ? 'off' : statusAllows(st, TASK) ? 'on' : 'limited'))
    .catch(() => setAi('off'))
    .finally(() => {
      statusPromise = null
    })
  statusPromise = p
  return p
}

const hidden = hiddenTracker(HIDDEN_MS)

/** Who is waiting for each call's answer. */
const waiters = new Map<string, (u: Understanding | null) => void>()

/** A call's request is over: with an answer, or (null) without one. */
function finish(id: string, u: Understanding | null) {
  setPending(id, false)
  const resolve = waiters.get(id)
  waiters.delete(id)
  resolve?.(u)
}

const queue = createQueue<Transmission>({
  maxInFlight: 2,
  maxWaiting: 4,
  paused: () => hidden.hiddenLong(),
  onDrop: (t) => finish(t.id, null),
  run: async (t, signal) => {
    if (Date.now() - (t.at + t.durationMs) > STALE_MS || Date.now() < pausedUntil) return finish(t.id, null)
    const results = useUnderstanding.getState().results
    const input = gatherInput(t, (id) => {
      const r = results[id]
      return r ? { text: r.cleaned, speaker: r.speaker } : undefined
    })
    const timeout = AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : signal
    let answer: RadioCleanupResult
    try {
      answer = await askAi<RadioCleanupResult>(TASK, input, { signal: timeout })
      failures = 0
    } catch (err) {
      finish(t.id, null)
      if (signal.aborted) return
      if (err instanceof AiUnavailableError && (err.code === 'daily_cap' || err.code === 'task_cap')) {
        // The day's allowance is used up: stop asking, and let go of every call still waiting.
        setAi('limited')
        queue.clear()
      } else if (err instanceof AiUnavailableError && (err.status === 401 || err.status === 0 || err.code === 'not_configured')) {
        // Not set up (or switched off) since the last check.
        setAi('off')
        queue.clear()
      } else if (++failures >= FAILS_BEFORE_PAUSE) {
        failures = 0
        pausedUntil = Date.now() + PAUSE_MS
      }
      return
    }
    finish(t.id, parseCleanup(t.id, t.raw ?? t.text, answer, runwayIdents(t.airport)))
  },
})

/** One word ("Roger.") has nothing to clean up or explain. */
export function worthAsking(t: Pick<Transmission, 'status' | 'text'>): boolean {
  return t.status === 'done' && t.text.trim().split(/\s+/).length >= 2
}

function enqueue(t: Transmission): Promise<Understanding | null> {
  return new Promise((resolve) => {
    waiters.set(t.id, resolve)
    setPending(t.id, true)
    queue.push(t)
  })
}

/**
 * Ask about one call. The promise resolves to the checked answer, or to null
 * when the request failed or was dropped. Returns null (no promise) when no
 * answer can come, so the caller need not wait: the call is too short to
 * need one, or AI is known to be off, not set up, or over its daily cap.
 */
export function requestUnderstanding(t: Transmission): Promise<Understanding | null> | null {
  if (!worthAsking(t)) return null
  // Keeps the answer fresh in the background; only the very first call waits for it.
  const checking = checkAi()
  const ai = useUnderstanding.getState().ai
  if (ai === 'off' || ai === 'limited') return null
  if (ai === 'on') return aiBlocked(TASK) ? null : enqueue(t)
  return checking.then(() => (useUnderstanding.getState().ai === 'on' ? enqueue(t) : null))
}

/** A call with an answer folded in: cleaned words (the raw kept beside them), a surer speaker, an aircraft the raw words missed. */
export function mergeUnderstanding(current: Transmission, u: Understanding, traffic: { callsign: string; icao24: string }[] = liveBuffer.sample()): { next: Transmission; added: StoredUnderstanding['added'] } {
  // An aircraft the raw words missed but the cleaned call names exactly.
  const added: StoredUnderstanding['added'] = []
  if (!current.icao24 && u.callsigns.length) {
    for (const cs of u.callsigns) {
      const a = traffic.find((x) => x.callsign.trim().toUpperCase() === cs)
      if (a && !added.some((x) => x.icao24 === a.icao24)) added.push({ callsign: a.callsign.trim(), icao24: a.icao24 })
    }
  }
  const callsigns: HeardCallsign[] = added.length ? [...added.map((a) => ({ callsign: a.callsign, icao24: a.icao24, confidence: 0.8 })), ...current.callsigns.filter((c) => c.icao24 && !added.some((a) => a.icao24 === c.icao24))] : current.callsigns
  const heard = current.raw ?? current.text
  const next: Transmission = { ...current, text: u.cleaned ?? heard, callsigns, icao24: current.icao24 ?? added[0]?.icao24 ?? null, speaker: u.speaker ?? current.speaker }
  // The raw words are kept only beside cleaned ones; a processed call is no longer marked.
  if (u.cleaned) next.raw = heard
  else delete next.raw
  delete next.unprocessed
  return { next, added }
}

const remember = (u: Understanding, next: Transmission, added: StoredUnderstanding['added']) => putResult({ ...u, at: next.at, airport: next.airport, stationId: next.stationId, targets: targetsFor(u, next), added })

/**
 * The call as it should be published: with its answer folded in, or, when
 * there is none for a call that should have had one, marked unprocessed.
 */
export function settleCall(t: Transmission, u: Understanding | null): Transmission {
  if (!u) return worthAsking(t) ? { ...t, unprocessed: true } : t
  const { next, added } = mergeUnderstanding(t, u)
  remember(u, next, added)
  return next
}

/**
 * A taxi clearance the published words garbled: route it from the other
 * version of the call, or from the instruction itself. `shown` is the text
 * the taxi watcher saw when the call was published; what it could parse, it
 * has already routed.
 */
export function routeTaxiFrom(next: Transmission, u: Understanding, shown: string) {
  const taxi = u.instructions.find((i) => i.kind === 'taxi')
  const target = next.icao24 ?? callAircraftIds(next)[0] ?? null
  if (!taxi || taxi.kind !== 'taxi' || !target || parseTaxi(shown)) return
  const fromInstruction = [taxi.runway ? `runway ${taxi.runway}` : '', taxi.via.length ? `taxi via ${taxi.via.join(', ')}` : ''].filter(Boolean).join(', ')
  const said = [next.text, next.raw ?? '', fromInstruction].find((x) => x && parseTaxi(x))
  if (said) void showTaxiRoute(said, target, next.airport, next.at)
}

/** An answer that came after its call was published without it: improve the call where it stands. */
export function applyUnderstanding(t: Transmission, u: Understanding) {
  const radio = useRadio.getState()
  const current = radio.log[t.stationId]?.find((x) => x.id === t.id)
  // Scrolled out of the log since: nothing left to improve.
  if (!current) return
  const { next, added } = mergeUnderstanding(current, u)
  remember(u, next, added)
  radio.upsert(next)

  // Still on the air: the halo changes colour with the speaker. Once the highlight has ended, only the transcript does.
  const focus = useRadio.getState().focus
  const ph = usePlayhead.getState()
  if (next.speaker !== current.speaker && focus && focus.until > Date.now() && useRadio.getState().caption?.id === t.id && ph.mode === 'live') {
    useRadio.getState().patch({ focus: { ...focus, speaker: next.speaker } })
    if (ph.activeCallsign && focus.ids.includes(ph.activeCallsign)) ph.setActive(ph.activeCallsign, next.speaker)
  }
  routeTaxiFrom(next, u, current.text)
}

/** Which aircraft each instruction is for: the callsign it names, else the call's aircraft. */
export function targetsFor(u: Pick<Understanding, 'instructions'>, t: Pick<Transmission, 'icao24' | 'callsigns'>, traffic: { callsign: string; icao24: string }[] = liveBuffer.sample()): (string | null)[] {
  const named = new Map(t.callsigns.filter((c) => c.icao24).map((c) => [c.callsign.toUpperCase().replace(/\s+/g, ''), c.icao24!]))
  const ids = callAircraftIds({ id: '', at: 0, ...t })
  const fallback = t.icao24 ?? (ids.length === 1 ? ids[0] : null)
  return u.instructions.map((i) => {
    if (!i.callsign) return fallback
    const hit = named.get(i.callsign) ?? traffic.find((a) => a.callsign.trim().toUpperCase() === i.callsign)?.icao24
    // A callsign nobody has: probably the call's own aircraft, misheard.
    return hit ?? (ids.length === 1 ? ids[0] : null)
  })
}

/** Keep the AI pass in step with the app: the on/off switch and airport changes. Returns a stop function. */
export function startUnderstanding(): () => void {
  void checkAi()
  // The switch flipped: find out again, and stop holding calls for answers that will not be asked for.
  const offAi = useAiSettings.subscribe((s, prev) => {
    if (s.enabled === prev.enabled) return
    failures = 0
    pausedUntil = 0
    if (s.enabled) resetAiLimits()
    else queue.clear()
    void checkAi(true)
  })
  const offPlayhead = usePlayhead.subscribe((s, prev) => {
    if (s.airportIcao !== prev.airportIcao) queue.clear()
  })
  return () => {
    offAi()
    offPlayhead()
    queue.clear()
  }
}

/** For tests: forget what is known about AI being available and drop any work in hand. */
export function resetUnderstandingForTests() {
  statusChecked = 0
  statusPromise = null
  failures = 0
  pausedUntil = 0
  queue.clear()
  waiters.clear()
  useUnderstanding.setState({ ai: 'unknown', pending: {}, results: {} })
}
