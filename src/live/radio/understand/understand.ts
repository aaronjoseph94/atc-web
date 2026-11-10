/**
 * The AI pass over live radio calls. Every call that comes out of the
 * transcriber is shown at once as heard; this then asks the `radioCleanup`
 * task (one request per call, two at a time) for a cleaned version, a plain
 * English line, the speaker and the instructions, and folds the answer back
 * in: the transcript swaps to the cleaned words, a confident speaker
 * replaces the rules' guess (re-colouring the highlight if the call is still
 * on the air), an aircraft the raw words missed is attached, and a taxi
 * clearance the raw words garbled gets its route.
 *
 * Without a key nothing is sent and nothing changes: the raw transcript and
 * the rules carry on as before.
 */
import { askAi, AiUnavailableError, getAiRunStatus } from '../../../ai/client'
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
import { putResult, setPending, useUnderstanding, type StoredUnderstanding } from './store'
import { callAircraftIds } from './threads'

/** Hidden this long, the page stops asking (the radio may still play in a background tab). */
const HIDDEN_MS = 45_000
/** A call older than this when its turn comes is not worth cleaning any more. */
const STALE_MS = 3 * 60_000
const REQUEST_TIMEOUT_MS = 30_000
/** After this many failures in a row, wait before asking again. */
const FAILS_BEFORE_PAUSE = 3
const PAUSE_MS = 60_000

let statusChecked = 0
let statusPromise: Promise<void> | null = null
let failures = 0
let pausedUntil = 0

/** Work out (once a while) whether AI can answer: a key on this device, or one on the server. */
export function checkAi(force = false): Promise<void> {
  const s = useAiSettings.getState()
  const set = (ai: 'on' | 'off') => {
    if (useUnderstanding.getState().ai !== ai) useUnderstanding.setState({ ai })
  }
  if (!s.enabled) {
    set('off')
    return Promise.resolve()
  }
  if (s.anthropicKey.trim() || s.openrouterKey.trim()) {
    set('on')
    return Promise.resolve()
  }
  if (!force && (statusPromise || Date.now() - statusChecked < 5 * 60_000)) return statusPromise ?? Promise.resolve()
  statusChecked = Date.now()
  const p = getAiRunStatus()
    .then((st) => set(st.configured ? 'on' : 'off'))
    .catch(() => set('off'))
    .finally(() => {
      statusPromise = null
    })
  statusPromise = p
  return p
}

const hidden = hiddenTracker(HIDDEN_MS)

const queue = createQueue<Transmission>({
  maxInFlight: 2,
  maxWaiting: 4,
  paused: () => hidden.hiddenLong(),
  onDrop: (t) => setPending(t.id, false),
  run: async (t, signal) => {
    if (Date.now() - (t.at + t.durationMs) > STALE_MS || Date.now() < pausedUntil) return setPending(t.id, false)
    const results = useUnderstanding.getState().results
    const input = gatherInput(t, (id) => {
      const r = results[id]
      return r ? { text: r.cleaned, speaker: r.speaker } : undefined
    })
    const timeout = AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : signal
    let answer: RadioCleanupResult
    try {
      answer = await askAi<RadioCleanupResult>('radioCleanup', input, { signal: timeout })
      failures = 0
    } catch (err) {
      setPending(t.id, false)
      // No key (or AI switched off) since the last check: stop asking until the settings change.
      if (err instanceof AiUnavailableError && (err.status === 401 || err.status === 0)) useUnderstanding.setState({ ai: 'off' })
      else if (++failures >= FAILS_BEFORE_PAUSE) {
        failures = 0
        pausedUntil = Date.now() + PAUSE_MS
      }
      return
    }
    const u = parseCleanup(t.id, t.text, answer, runwayIdents(t.airport))
    if (!u) return setPending(t.id, false)
    applyUnderstanding(t, u)
  },
})

/** Fold an answer into the app: store it, and update the call where the answer knows better. */
export function applyUnderstanding(t: Transmission, u: Understanding) {
  const radio = useRadio.getState()
  const current = radio.log[t.stationId]?.find((x) => x.id === t.id) ?? t

  // An aircraft the raw words missed but the cleaned call names exactly.
  const added: StoredUnderstanding['added'] = []
  if (!current.icao24 && u.callsigns.length) {
    const traffic = liveBuffer.sample()
    for (const cs of u.callsigns) {
      const a = traffic.find((x) => x.callsign.trim().toUpperCase() === cs)
      if (a && !added.some((x) => x.icao24 === a.icao24)) added.push({ callsign: a.callsign.trim(), icao24: a.icao24 })
    }
  }
  const callsigns: HeardCallsign[] = added.length ? [...added.map((a) => ({ callsign: a.callsign, icao24: a.icao24, confidence: 0.8 })), ...current.callsigns.filter((c) => c.icao24 && !added.some((a) => a.icao24 === c.icao24))] : current.callsigns
  const icao24 = current.icao24 ?? added[0]?.icao24 ?? null
  const speaker = u.speaker ?? current.speaker
  const next: Transmission = { ...current, callsigns, icao24, speaker }

  putResult({ ...u, at: t.at, airport: t.airport, stationId: t.stationId, targets: targetsFor(u, next), added })

  if (speaker !== current.speaker || added.length) {
    radio.upsert(next)
    // Still on the air: the halo and ripple change colour with it. Once the highlight has ended, only the transcript does.
    const focus = useRadio.getState().focus
    const ph = usePlayhead.getState()
    if (speaker !== current.speaker && focus && focus.until > Date.now() && useRadio.getState().caption?.id === t.id && ph.mode === 'live') {
      useRadio.getState().patch({ focus: { ...focus, speaker } })
      if (ph.activeCallsign && focus.ids.includes(ph.activeCallsign)) ph.setActive(ph.activeCallsign, speaker)
    }
  }

  // A taxi clearance the raw words garbled: route it from the cleaned call (or from the instruction itself).
  const taxi = u.instructions.find((i) => i.kind === 'taxi')
  const target = icao24 ?? callAircraftIds(next)[0] ?? null
  if (taxi && taxi.kind === 'taxi' && target && !parseTaxi(t.text)) {
    const said = u.cleaned && parseTaxi(u.cleaned) ? u.cleaned : [taxi.runway ? `runway ${taxi.runway}` : '', taxi.via.length ? `taxi via ${taxi.via.join(', ')}` : ''].filter(Boolean).join(', ')
    if (parseTaxi(said)) void showTaxiRoute(said, target, t.airport, t.at)
  }
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

/** Ask about one call. */
export function understandCall(t: Transmission) {
  if (t.status !== 'done' || !t.text.trim() || t.text.trim().split(/\s+/).length < 2) return
  const st = useUnderstanding.getState()
  if (st.results[t.id] || st.pending[t.id]) return
  void checkAi().then(() => {
    if (useUnderstanding.getState().ai !== 'on') return
    setPending(t.id, true)
    queue.push(t)
  })
}

/** Start the AI pass over new live calls. Returns a stop function. */
export function startUnderstanding(): () => void {
  const seen = new Set<string>()
  // Calls already logged when this starts were heard before; leave them as they are.
  for (const list of Object.values(useRadio.getState().log)) for (const t of list) seen.add(t.id)
  const offRadio = useRadio.subscribe((s, prev) => {
    if (s.log === prev.log) return
    for (const list of Object.values(s.log))
      for (const t of list) {
        if (seen.has(t.id) || t.status !== 'done' || !t.text) continue
        seen.add(t.id)
        understandCall(t)
      }
  })
  // New keys or the switch flipped: find out again.
  const offAi = useAiSettings.subscribe((s, prev) => {
    if (s.enabled !== prev.enabled || s.anthropicKey !== prev.anthropicKey || s.openrouterKey !== prev.openrouterKey || s.provider !== prev.provider) {
      failures = 0
      pausedUntil = 0
      void checkAi(true)
    }
  })
  const offPlayhead = usePlayhead.subscribe((s, prev) => {
    if (s.airportIcao !== prev.airportIcao) queue.clear()
  })
  return () => {
    offRadio()
    offAi()
    offPlayhead()
    queue.clear()
  }
}
