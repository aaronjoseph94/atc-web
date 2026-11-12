/**
 * Shared storage for the things every request has to agree on: how many AI
 * requests were made today, how many AirNav credits are gone, and answers
 * that must not be paid for twice.
 *
 * Two places can hold them on Cloudflare:
 *  - a KV namespace bound as `AI_KV` (one copy for the whole world; the
 *    owner has to create it, see docs/ai-setup.md), or
 *  - the Cache API (`caches.default`), which needs no setup but is kept per
 *    data centre and may drop entries whenever it likes. Counts kept there
 *    are approximate: each data centre counts on its own.
 * Every counter is also mirrored in the isolate's memory, so a write that
 * has not landed yet (or a store that lost it) cannot make the count go down.
 *
 * Kept free of Workers types so the dev server and the tests can use it.
 */
import { cacheApiJson, type CacheLike } from './edgeCache'
import { memoryCache, type JsonCache } from './sourceHealth'

export type StorageKind = 'kv' | 'cache' | 'memory'

/** A JSON store with expiry, and where it lives (shown in diagnostics). */
export type JsonStore = JsonCache & { kind: StorageKind }

/** The two KV methods used (a `KVNamespace` fits). */
export type KvLike = {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

/** True for a real KV binding (a plain variable with the same name is ignored). */
export function isKv(v: unknown): v is KvLike {
  return !!v && typeof (v as KvLike).get === 'function' && typeof (v as KvLike).put === 'function'
}

/** KV never expires a key sooner than a minute after it is written. */
const KV_MIN_TTL_S = 60

export function kvStorage(kv: KvLike): JsonStore {
  return {
    kind: 'kv',
    async get<T>(key: string) {
      try {
        const s = await kv.get(key)
        return s == null ? undefined : (JSON.parse(s) as T)
      } catch {
        return undefined
      }
    },
    async put(key, value, ttlSeconds) {
      try {
        await kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(KV_MIN_TTL_S, Math.round(ttlSeconds)) })
      } catch {
        // Out of free writes for the day, or KV is having a moment: the other layers still count.
      }
    },
  }
}

export function cacheStorage(cache: CacheLike, origin: string, waitUntil?: (p: Promise<unknown>) => void): JsonStore {
  return { kind: 'cache', ...cacheApiJson(cache, origin, waitUntil) }
}

export function memoryStorage(now: () => number = Date.now): JsonStore {
  return { kind: 'memory', ...memoryCache(2000, now) }
}

/** Read the nearer store first, then the farther one; write both. For answers that must be found again. */
export function tiered(near: JsonStore, far: JsonStore | null): JsonStore {
  if (!far) return near
  return {
    kind: far.kind,
    async get<T>(key: string) {
      return (await near.get<T>(key)) ?? (await far.get<T>(key))
    },
    async put(key, value, ttlSeconds) {
      await Promise.all([near.put(key, value, ttlSeconds), far.put(key, value, ttlSeconds)])
    },
  }
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

export type Counters = {
  kind: StorageKind
  get(key: string): Promise<number>
  set(key: string, n: number, ttlSeconds: number): Promise<void>
  /** Add `by` and return the new count. Read-then-write, so two requests at the same instant can count as one. */
  add(key: string, by: number, ttlSeconds: number): Promise<number>
}

type Mirror = Map<string, { n: number; expires: number }>

/** This isolate's copy of every counter it has touched. */
const isolateMirror: Mirror = new Map()
const MIRROR_LIMIT = 5000

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Counters in a store, never lower than what this isolate last saw or wrote
 * (the Cache API writes after the response; KV takes a while to show a write).
 */
export function storeCounters(store: JsonStore, opts: { mirror?: Mirror; now?: () => number } = {}): Counters {
  const mirror = opts.mirror ?? isolateMirror
  const now = opts.now ?? Date.now
  const local = (key: string) => {
    const hit = mirror.get(key)
    if (!hit) return 0
    if (now() >= hit.expires) {
      mirror.delete(key)
      return 0
    }
    return hit.n
  }
  const self: Counters = {
    kind: store.kind,
    async get(key) {
      return Math.max(num(await store.get<number>(key)), local(key))
    },
    async set(key, n, ttlSeconds) {
      mirror.set(key, { n, expires: now() + ttlSeconds * 1000 })
      if (mirror.size > MIRROR_LIMIT) mirror.delete(mirror.keys().next().value!)
      await store.put(key, n, ttlSeconds)
    },
    async add(key, by, ttlSeconds) {
      const n = (await self.get(key)) + by
      await self.set(key, n, ttlSeconds)
      return n
    },
  }
  return self
}

/** The highest count any of the stores knows, written back to all of them. For counts that must not be lost. */
export function maxCounters(...all: Counters[]): Counters {
  const self: Counters = {
    kind: all[0].kind,
    async get(key) {
      return Math.max(...(await Promise.all(all.map((c) => c.get(key)))))
    },
    async set(key, n, ttlSeconds) {
      await Promise.all(all.map((c) => c.set(key, n, ttlSeconds)))
    },
    async add(key, by, ttlSeconds) {
      const n = (await self.get(key)) + by
      await self.set(key, n, ttlSeconds)
      return n
    },
  }
  return self
}

/** What a data centre has counted since it last wrote to KV. */
type Pending = { n: number; at: number }
const isolatePending = new Map<string, Pending>()
/** How long this isolate trusts its own copy of the pending count over the cache's. */
const PENDING_FRESH_MS = 30_000
/** KV's count as this isolate last read it, reused for a short while so a busy minute is a handful of KV reads, not hundreds (the free plan allows 100,000 a day). */
const isolateTotals = new Map<string, Pending>()
const TOTAL_FRESH_MS = 20_000

/**
 * A worldwide count in KV, written only every `every` additions: the free KV
 * plan allows 1,000 writes a day, far fewer than the AI requests a busy day
 * makes. In between, each data centre keeps its own additions in `near` (the
 * Cache API). The total is KV's count plus this data centre's unwritten
 * additions, so it runs a little behind what other data centres are doing.
 */
export function syncedCounters(kv: Counters, near: JsonStore, opts: { every?: number; pending?: Map<string, Pending>; totals?: Map<string, Pending>; now?: () => number } = {}): Counters {
  const every = opts.every ?? 10
  const mem = opts.pending ?? isolatePending
  const totals = opts.totals ?? isolateTotals
  const now = opts.now ?? Date.now
  const pkey = (key: string) => `pending:${key}`
  const readTotal = async (key: string) => {
    const seen = totals.get(key)
    if (seen && now() - seen.at < TOTAL_FRESH_MS) return seen.n
    const n = await kv.get(key)
    totals.set(key, { n, at: now() })
    if (totals.size > MIRROR_LIMIT) totals.delete(totals.keys().next().value!)
    return n
  }
  const writeTotal = async (key: string, n: number, ttlSeconds: number) => {
    totals.set(key, { n, at: now() })
    await kv.set(key, n, ttlSeconds)
  }
  const readPending = async (key: string) => {
    const mine = mem.get(key)
    if (mine && now() - mine.at < PENDING_FRESH_MS) return mine.n
    return num(await near.get<number>(pkey(key)))
  }
  const writePending = async (key: string, n: number, ttlSeconds: number) => {
    mem.set(key, { n, at: now() })
    if (mem.size > MIRROR_LIMIT) mem.delete(mem.keys().next().value!)
    await near.put(pkey(key), n, ttlSeconds)
  }
  return {
    kind: 'kv',
    async get(key) {
      const [total, pending] = await Promise.all([readTotal(key), readPending(key)])
      return total + pending
    },
    async set(key, n, ttlSeconds) {
      await Promise.all([writeTotal(key, n, ttlSeconds), writePending(key, 0, ttlSeconds)])
    },
    async add(key, by, ttlSeconds) {
      const before = await readPending(key)
      const pending = before + by
      if (pending >= every) {
        // Time to write: read KV afresh first, so what other data centres wrote meanwhile is kept.
        const total = await kv.get(key)
        await Promise.all([writeTotal(key, total + pending, ttlSeconds), writePending(key, 0, ttlSeconds)])
        return total + pending
      }
      await writePending(key, pending, ttlSeconds)
      return (await readTotal(key)) + pending
    },
  }
}

/** The stores a request can use on Cloudflare: the data centre's cache, and KV when the owner has bound it. */
export type EdgeStores = { near: JsonStore; kv: JsonStore | null }

export function edgeStores(env: { AI_KV?: unknown }, cache: CacheLike, origin: string, waitUntil?: (p: Promise<unknown>) => void): EdgeStores {
  return { near: cacheStorage(cache, origin, waitUntil), kv: isKv(env.AI_KV) ? kvStorage(env.AI_KV) : null }
}

/** Counters for things that happen often (AI requests): few KV writes, a count that may lag. */
export function busyCounters(s: EdgeStores): Counters {
  return s.kv ? syncedCounters(storeCounters(s.kv), s.near) : storeCounters(s.near)
}

/** Counters for things that happen rarely and cost real credits (AirNav): every count written everywhere at once. */
export function exactCounters(s: EdgeStores): Counters {
  return s.kv ? maxCounters(storeCounters(s.kv), storeCounters(s.near)) : storeCounters(s.near)
}

/** Where answers that were paid for are kept. */
export function durableStore(s: EdgeStores): JsonStore {
  return tiered(s.near, s.kv)
}

/** `2026-11-12`: counters reset at midnight UTC. */
export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10)

/** The coming midnight UTC (epoch ms). */
export const nextDayStart = (now: number) => Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1)

export const secondsToNextDay = (now: number) => Math.max(1, Math.ceil((nextDayStart(now) - now) / 1000))

/** Daily counters are kept a little past their day. */
export const DAY_TTL_S = 2 * 24 * 3600
