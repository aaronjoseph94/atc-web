/**
 * What stands between a visitor and the owner's AI bill, now that every
 * request is paid for with the site's own key:
 *
 *  1. Same-origin: only this site's pages may ask (stops other sites and
 *     casual scripts using the endpoint as a free model).
 *  2. A per-visitor rate limit (by IP address): a short burst and a
 *     per-minute ceiling.
 *  3. A daily cap on requests for the whole site, with a smaller cap for the
 *     per-transmission radio task so it cannot use up everyone else's share.
 *
 * Counts live in shared storage (see ../storage.ts). The pure parts are here
 * so they can be tested without a server.
 */
import { DAY_TTL_S, dayKey, nextDayStart, secondsToNextDay, type Counters, type JsonStore, type StorageKind } from '../storage'

export type LimitEnv = {
  /** Most AI requests a day, site-wide (default 3000; 0 switches AI off). */
  AI_DAILY_CAP?: string
  /** Per-task daily caps, e.g. `radioCleanup=1500,flightStory=300`. */
  AI_TASK_CAPS?: string
  /** Per visitor: requests allowed in any ten seconds (default 20) and in any minute (default 60). */
  AI_RATE_BURST?: string
  AI_RATE_PER_MIN?: string
}

export const DEFAULT_DAILY_CAP = 3000
/** Share of the daily cap a task may use when `AI_TASK_CAPS` does not say. Radio is asked once per transmission, so it is the one that could crowd out the rest. */
export const DEFAULT_TASK_SHARE: Record<string, number> = { radioCleanup: 0.7 }
export const DEFAULT_RATE = { burst: 20, perMinute: 60 }
const BURST_WINDOW_S = 10

const int = (v: string | undefined, fallback: number) => {
  const n = Number((v ?? '').trim())
  return (v ?? '').trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

export type AiCaps = { daily: number; tasks: Record<string, number> }

export function aiCaps(env: LimitEnv): AiCaps {
  const daily = int(env.AI_DAILY_CAP, DEFAULT_DAILY_CAP)
  const tasks: Record<string, number> = {}
  for (const [name, share] of Object.entries(DEFAULT_TASK_SHARE)) tasks[name] = Math.floor(daily * share)
  for (const part of (env.AI_TASK_CAPS ?? '').split(',')) {
    const m = /^\s*([\w-]+)\s*=\s*(\d+)\s*$/.exec(part)
    if (m) tasks[m[1]] = Math.min(daily, Number(m[2]))
  }
  return { daily, tasks }
}

// ---------------------------------------------------------------------------
// Same origin
// ---------------------------------------------------------------------------

export type OriginHeaders = { origin: string | null; referer: string | null; fetchSite: string | null }

const originOf = (url: string | null) => {
  try {
    return url ? new URL(url).origin : null
  } catch {
    return null
  }
}

/**
 * True when the request came from a page of this site. Browsers say so three
 * ways (`Sec-Fetch-Site`, `Origin` on POSTs, `Referer`); one that names
 * another site fails, and a request with none of them (a script) fails too.
 */
export function isSameOrigin(self: string, h: OriginHeaders): boolean {
  if (h.fetchSite && h.fetchSite !== 'same-origin') return false
  if (h.origin) return originOf(h.origin) === self
  if (h.referer) return originOf(h.referer) === self
  return h.fetchSite === 'same-origin'
}

export const originHeaders = (get: (name: string) => string | null): OriginHeaders => ({ origin: get('origin'), referer: get('referer'), fetchSite: get('sec-fetch-site') })

// ---------------------------------------------------------------------------
// Per-visitor rate limit
// ---------------------------------------------------------------------------

/** One visitor's recent requests: a ten-second window and a minute window, each with its start. */
export type RateDoc = { bAt: number; b: number; mAt: number; m: number }

/** Count one request. Pure: returns the document to store and whether the request may go ahead. */
export function stepRate(prev: RateDoc | undefined, now: number, limits = DEFAULT_RATE): { next: RateDoc; ok: boolean; retryAfterS: number } {
  const bAt = Math.floor(now / (BURST_WINDOW_S * 1000))
  const mAt = Math.floor(now / 60_000)
  const b = prev && prev.bAt === bAt ? prev.b : 0
  const m = prev && prev.mAt === mAt ? prev.m : 0
  if (m >= limits.perMinute) return { next: { bAt, b, mAt, m }, ok: false, retryAfterS: Math.max(1, Math.ceil(((mAt + 1) * 60_000 - now) / 1000)) }
  if (b >= limits.burst) return { next: { bAt, b, mAt, m }, ok: false, retryAfterS: Math.max(1, Math.ceil(((bAt + 1) * BURST_WINDOW_S * 1000 - now) / 1000)) }
  return { next: { bAt, b: b + 1, mAt, m: m + 1 }, ok: true, retryAfterS: 0 }
}

/** This isolate's view of each visitor, so a burst is caught before the shared store has caught up. */
const isolateRates = new Map<string, RateDoc>()

/** Addresses are not kept as they are: the key is a short hash. */
async function clientKey(client: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`atc-rate:${client}`))
  return [...new Uint8Array(digest).slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function checkRate(store: JsonStore, client: string, env: LimitEnv, now: number, memory: Map<string, RateDoc> = isolateRates): Promise<{ ok: boolean; retryAfterS: number }> {
  const limits = { burst: int(env.AI_RATE_BURST, DEFAULT_RATE.burst), perMinute: int(env.AI_RATE_PER_MIN, DEFAULT_RATE.perMinute) }
  const key = `rate:${await clientKey(client)}`
  const shared = await store.get<RateDoc>(key)
  const mine = memory.get(key)
  // Whichever copy has seen more of this visitor in the current windows.
  const prev = !mine ? shared : !shared ? mine : mine.mAt > shared.mAt || (mine.mAt === shared.mAt && mine.m >= shared.m) ? mine : shared
  const r = stepRate(prev, now, limits)
  memory.set(key, r.next)
  if (memory.size > 5000) memory.delete(memory.keys().next().value!)
  if (r.ok) await store.put(key, r.next, 120)
  return { ok: r.ok, retryAfterS: r.retryAfterS }
}

// ---------------------------------------------------------------------------
// Daily caps
// ---------------------------------------------------------------------------

export type AiUsage = {
  /** The UTC day being counted. */
  day: string
  today: number
  cap: number
  /** True once the site-wide cap is reached. */
  limited: boolean
  /** When the count starts again (ISO time, midnight UTC). */
  resetsAt: string
  /** Per-task counts, for tasks that have their own cap. */
  tasks: Record<string, { today: number; cap: number }>
  /** Where the count is kept: `kv` is one count for the world, `cache` one per Cloudflare data centre, `memory` the dev server. */
  storage: StorageKind
}

const totalKey = (day: string) => `ai:${day}:total`
const taskKey = (day: string, task: string) => `ai:${day}:task:${task}`

export async function aiUsage(counters: Counters, env: LimitEnv, now: number): Promise<AiUsage> {
  const caps = aiCaps(env)
  const day = dayKey(now)
  const names = Object.keys(caps.tasks)
  const [today, ...perTask] = await Promise.all([counters.get(totalKey(day)), ...names.map((n) => counters.get(taskKey(day, n)))])
  return {
    day,
    today,
    cap: caps.daily,
    limited: today >= caps.daily,
    resetsAt: new Date(nextDayStart(now)).toISOString(),
    tasks: Object.fromEntries(names.map((n, i) => [n, { today: perTask[i], cap: caps.tasks[n] }])),
    storage: counters.kind,
  }
}

export type Reservation = { ok: true } | { ok: false; code: 'daily_cap' | 'task_cap'; retryAfterS: number }

/** Count one request about to be sent to the model, unless a cap says no. */
export async function reserveAi(counters: Counters, task: string, env: LimitEnv, now: number): Promise<Reservation> {
  const caps = aiCaps(env)
  const day = dayKey(now)
  const retryAfterS = secondsToNextDay(now)
  const taskCap = caps.tasks[task]
  const [total, mine] = await Promise.all([counters.get(totalKey(day)), taskCap != null ? counters.get(taskKey(day, task)) : Promise.resolve(0)])
  if (total >= caps.daily) return { ok: false, code: 'daily_cap', retryAfterS }
  if (taskCap != null && mine >= taskCap) return { ok: false, code: 'task_cap', retryAfterS }
  await Promise.all([counters.add(totalKey(day), 1, DAY_TTL_S), taskCap != null ? counters.add(taskKey(day, task), 1, DAY_TTL_S) : Promise.resolve(0)])
  return { ok: true }
}
