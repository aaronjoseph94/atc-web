/**
 * Shared plumbing for the free upstream data sources: a small circuit breaker
 * per source, a health-aware ordering, a hedged "first good answer wins"
 * helper and a tiny cache interface the edge and the dev server both fill.
 *
 * Everything here is in-memory and per process. On Cloudflare that means per
 * isolate, which lives for many requests, so a feed that starts failing is
 * skipped within a couple of polls instead of costing every request a timeout.
 */

/** What a source is used for (only shapes `/api/health`). */
export type SourceKind = 'adsb' | 'metadata' | 'weather'

/** One upstream source as reported by `/api/health`. */
export type SourceStatus = {
  name: string
  kind: SourceKind
  /** `closed` = in use, `open` = skipped after failures, `half-open` = cooling down is over, next request is a trial. */
  breaker: 'closed' | 'open' | 'half-open'
  /** Result of the most recent attempt (or active probe). */
  ok: boolean | null
  latencyMs: number | null
  /** Items in the last good answer (aircraft for ADS-B feeds). */
  count?: number | null
  error?: string | null
  lastSuccessAt?: string | null
  lastFailureAt?: string | null
  /** When an open breaker lets the source be tried again. */
  retryAt?: string | null
  /** Disabled sources are known but not called (e.g. need permission first). */
  enabled?: boolean
  note?: string
}

type Entry = {
  consecutiveFailures: number
  /** Epoch ms until which the source is skipped; 0 = closed. */
  openUntil: number
  lastError: string | null
  lastSuccessAt: number | null
  lastFailureAt: number | null
  /** Smoothed latency of successful calls. */
  latencyMs: number | null
  lastOk: boolean | null
  lastCount: number | null
  /** Length of the current (or last) cool-down. */
  cooldownMs: number
}

export type BreakerOptions = {
  /** Failures in a row that open the breaker. */
  failureThreshold?: number
  /** First cool-down; doubles on each failed trial up to `maxCooldownMs`. */
  cooldownMs?: number
  maxCooldownMs?: number
  now?: () => number
}

/** Errors that say "stop asking for a while", not "try again next poll". */
export class UpstreamError extends Error {
  readonly status: number | null
  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'UpstreamError'
    this.status = status
  }
}

/**
 * Circuit breaker + health bookkeeping for a set of named sources.
 *
 * After `failureThreshold` failures in a row a source is skipped for a
 * cool-down; the first request after it is a trial (half-open). A failed
 * trial doubles the cool-down, a success closes the breaker. Rate-limit and
 * permission answers open it straight away (429: a minute, then doubling;
 * 403: the maximum), since hammering a feed that asked us to slow down only
 * makes the ban longer. It also remembers when each source was last called,
 * so per-second limits can be respected before a 429 happens.
 */
export class SourceHealth {
  private entries = new Map<string, Entry>()
  private lastAttempt = new Map<string, number>()
  private readonly threshold: number
  private readonly cooldown: number
  private readonly maxCooldown: number
  private readonly now: () => number

  constructor(opts: BreakerOptions = {}) {
    this.threshold = opts.failureThreshold ?? 2
    this.cooldown = opts.cooldownMs ?? 20_000
    this.maxCooldown = opts.maxCooldownMs ?? 5 * 60_000
    this.now = opts.now ?? Date.now
  }

  private get(name: string): Entry {
    let e = this.entries.get(name)
    if (!e) {
      e = { consecutiveFailures: 0, openUntil: 0, lastError: null, lastSuccessAt: null, lastFailureAt: null, latencyMs: null, lastOk: null, lastCount: null, cooldownMs: this.cooldown }
      this.entries.set(name, e)
    }
    return e
  }

  state(name: string): SourceStatus['breaker'] {
    const e = this.entries.get(name)
    if (!e || e.openUntil === 0) return 'closed'
    return this.now() < e.openUntil ? 'open' : 'half-open'
  }

  /** True while the source should be skipped. */
  isOpen(name: string): boolean {
    return this.state(name) === 'open'
  }

  recordSuccess(name: string, latencyMs: number, count?: number) {
    const e = this.get(name)
    e.consecutiveFailures = 0
    e.openUntil = 0
    e.cooldownMs = this.cooldown
    e.lastOk = true
    e.lastError = null
    e.lastSuccessAt = this.now()
    e.latencyMs = e.latencyMs == null ? latencyMs : Math.round(e.latencyMs * 0.7 + latencyMs * 0.3)
    if (count != null) e.lastCount = count
  }

  recordFailure(name: string, err: unknown) {
    const e = this.get(name)
    const now = this.now()
    const wasTrial = e.openUntil !== 0 && now >= e.openUntil
    e.consecutiveFailures++
    e.lastOk = false
    e.lastFailureAt = now
    e.lastError = errorText(err)
    const status = err instanceof UpstreamError ? err.status : null

    if (status === 403) {
      // Not allowed (or told to get permission): wait the long way round.
      e.cooldownMs = this.maxCooldown
    } else if (status === 429) {
      // Slow down: a minute at first, doubling while it keeps happening.
      e.cooldownMs = wasTrial || e.openUntil !== 0 ? Math.min(this.maxCooldown, e.cooldownMs * 2) : Math.min(this.maxCooldown, 60_000)
    } else if (wasTrial) {
      e.cooldownMs = Math.min(this.maxCooldown, e.cooldownMs * 2)
    } else if (e.consecutiveFailures >= this.threshold) {
      e.cooldownMs = this.cooldown
    } else {
      return
    }
    e.openUntil = now + e.cooldownMs
  }

  /**
   * Healthiest first: closed breakers (fewest recent failures, then the
   * configured order), then half-open ones due a trial, then open ones
   * soonest-to-reopen. Open sources stay in the list so that when everything
   * is down we still try something rather than answer nothing.
   */
  order<T extends { name: string }>(sources: T[]): T[] {
    const now = this.now()
    const rank = (s: T) => {
      const e = this.entries.get(s.name)
      if (!e || e.openUntil === 0) return 0
      return now >= e.openUntil ? 1 : 2
    }
    return sources
      .map((s, i) => ({ s, i }))
      .sort((a, b) => {
        const ra = rank(a.s)
        const rb = rank(b.s)
        if (ra !== rb) return ra - rb
        const ea = this.entries.get(a.s.name)
        const eb = this.entries.get(b.s.name)
        if (ra === 2) return (ea?.openUntil ?? 0) - (eb?.openUntil ?? 0)
        const fa = ea?.consecutiveFailures ?? 0
        const fb = eb?.consecutiveFailures ?? 0
        return fa !== fb ? fa - fb : a.i - b.i
      })
      .map((x) => x.s)
  }

  status(name: string, kind: SourceKind): SourceStatus {
    const e = this.entries.get(name)
    const iso = (t: number | null | undefined) => (t ? new Date(t).toISOString() : null)
    const breaker = this.state(name)
    return {
      name,
      kind,
      breaker,
      ok: e?.lastOk ?? null,
      latencyMs: e?.latencyMs ?? null,
      count: e?.lastCount ?? null,
      error: e?.lastError ?? null,
      lastSuccessAt: iso(e?.lastSuccessAt),
      lastFailureAt: iso(e?.lastFailureAt),
      retryAt: breaker === 'open' ? iso(e?.openUntil) : null,
    }
  }

  /** Note that a request to the source is starting now. */
  markAttempt(name: string) {
    this.lastAttempt.set(name, this.now())
  }

  /** Milliseconds since the source was last called (Infinity if never). */
  sinceLastAttempt(name: string): number {
    const t = this.lastAttempt.get(name)
    return t == null ? Infinity : this.now() - t
  }

  reset() {
    this.entries.clear()
    this.lastAttempt.clear()
  }
}

/** Process-wide breaker shared by every upstream call in this isolate. */
export const sourceHealth = new SourceHealth()

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timed out' : err.message
  return String(err)
}

// ---------------------------------------------------------------------------
// Hedged "first good answer"
// ---------------------------------------------------------------------------

export type Attempt<T> = {
  name: string
  run: (signal: AbortSignal) => Promise<T>
}

export type HedgeOptions<T> = {
  /** Start the next attempt if the current one hasn't answered by then. */
  hedgeMs?: number
  timeoutMs?: number
  /** A resolved value that should count as a miss (e.g. an empty lookup). */
  isGood?: (value: T) => boolean
  health?: SourceHealth
}

export type HedgeResult<T> = { value: T; source: string } | { value: null; source: null; errors: string[] }

/**
 * Try attempts in order, starting the next one early when the current one is
 * slow, and resolve with the first good value. Earlier attempts win ties: a
 * later answer is only taken once every earlier attempt has failed or missed,
 * or the earlier one is still pending past the hedge (then whoever lands first
 * wins). Never rejects: when nothing is good the errors are returned.
 */
export function hedgedFirst<T>(attempts: Attempt<T>[], opts: HedgeOptions<T> = {}): Promise<HedgeResult<T>> {
  const hedgeMs = opts.hedgeMs ?? 2500
  const timeoutMs = opts.timeoutMs ?? 6000
  const isGood = opts.isGood ?? ((v: T) => v != null)
  const health = opts.health
  const list = health ? health.order(attempts) : attempts

  return new Promise((resolve) => {
    const errors: string[] = []
    const controllers: AbortController[] = []
    let next = 0
    let pending = 0
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (r: HedgeResult<T>) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      for (const c of controllers) c.abort()
      resolve(r)
    }

    const launch = () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (done || next >= list.length) return
      const a = list[next++]
      const ctrl = new AbortController()
      controllers.push(ctrl)
      pending++
      const t0 = Date.now()
      if (next < list.length) timer = setTimeout(launch, hedgeMs)
      a.run(AbortSignal.any([ctrl.signal, AbortSignal.timeout(timeoutMs)])).then(
        (value) => {
          pending--
          if (done) return
          health?.recordSuccess(a.name, Date.now() - t0)
          if (isGood(value)) return finish({ value, source: a.name })
          errors.push(`${a.name}: no data`)
          settle()
        },
        (err: unknown) => {
          pending--
          if (done) return
          health?.recordFailure(a.name, err)
          errors.push(`${a.name}: ${errorText(err)}`)
          settle()
        },
      )
    }

    const settle = () => {
      if (next < list.length) launch()
      else if (pending === 0) finish({ value: null, source: null, errors })
    }

    if (list.length === 0) finish({ value: null, source: null, errors })
    else launch()
  })
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Minimal JSON cache. Pages Functions back it with the Cloudflare Cache API
 * (shared by every request in a colo); the dev server and tests use memory.
 */
export type JsonCache = {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown, ttlSeconds: number): Promise<void>
}

/** In-memory `JsonCache` with expiry; bounded so a long dev session can't grow forever. */
export function memoryCache(maxEntries = 500, now: () => number = Date.now): JsonCache {
  const store = new Map<string, { value: unknown; expires: number }>()
  return {
    async get<T>(key: string) {
      const hit = store.get(key)
      if (!hit) return undefined
      if (now() >= hit.expires) {
        store.delete(key)
        return undefined
      }
      return hit.value as T
    },
    async put(key, value, ttlSeconds) {
      if (store.size >= maxEntries) store.delete(store.keys().next().value as string)
      store.set(key, { value, expires: now() + ttlSeconds * 1000 })
    },
  }
}

/** A cache that never stores anything (lookups always go upstream). */
export const noCache: JsonCache = {
  async get() {
    return undefined
  },
  async put() {},
}
