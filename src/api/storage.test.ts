/* oxlint-disable no-await-in-loop -- the steps in these tests happen one after another on purpose */
import { describe, expect, it } from 'vitest'
import type { CacheLike } from './edgeCache'
import { busyCounters, cacheStorage, dayKey, durableStore, edgeStores, exactCounters, isKv, kvStorage, maxCounters, memoryStorage, secondsToNextDay, storeCounters, syncedCounters, tiered, type KvLike } from './storage'

/** A stand-in for `caches.default`: responses by URL, honouring `max-age`. */
function fakeCache(now: () => number = Date.now) {
  const entries = new Map<string, { body: string; expires: number }>()
  const cache: CacheLike & { entries: typeof entries; puts: number } = {
    entries,
    puts: 0,
    async match(req) {
      const hit = entries.get(req.url)
      if (!hit || now() >= hit.expires) return undefined
      return new Response(hit.body)
    },
    async put(req, res) {
      cache.puts++
      const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 0)
      entries.set(req.url, { body: await res.text(), expires: now() + maxAge * 1000 })
    },
  }
  return cache
}

/** A stand-in for a KV namespace that counts its writes (the free plan allows 1,000 a day). */
function fakeKv() {
  const data = new Map<string, string>()
  const kv: KvLike & { data: typeof data; writes: number; failing: boolean; ttls: number[] } = {
    data,
    writes: 0,
    failing: false,
    ttls: [],
    async get(key) {
      if (kv.failing) throw new Error('KV down')
      return data.get(key) ?? null
    },
    async put(key, value, options) {
      if (kv.failing) throw new Error('KV write limit')
      kv.writes++
      kv.ttls.push(options?.expirationTtl ?? 0)
      data.set(key, value)
    },
  }
  return kv
}

describe('stores', () => {
  it('KV: JSON in and out, a minimum expiry of a minute, and failures read as "nothing"', async () => {
    const kv = fakeKv()
    const s = kvStorage(kv)
    await s.put('a', { n: 1 }, 5)
    expect(await s.get('a')).toEqual({ n: 1 })
    expect(kv.ttls).toEqual([60])
    kv.failing = true
    expect(await s.get('a')).toBeUndefined()
    await expect(s.put('a', 2, 60)).resolves.toBeUndefined()
  })

  it('only a real KV binding counts as one', () => {
    expect(isKv(fakeKv())).toBe(true)
    expect(isKv('some-id')).toBe(false)
    expect(isKv(undefined)).toBe(false)
  })

  it('tiered: reads the near store first, falls back to the far one, writes both', async () => {
    const near = memoryStorage()
    const far = kvStorage(fakeKv())
    const t = tiered(near, far)
    await far.put('k', 'from-kv', 60)
    expect(await t.get('k')).toBe('from-kv')
    await t.put('k2', 'both', 60)
    expect(await near.get('k2')).toBe('both')
    expect(await far.get('k2')).toBe('both')
    expect(tiered(near, null)).toBe(near)
  })

  it('day keys and the time to the next UTC day', () => {
    const t = Date.UTC(2026, 10, 12, 23, 59, 30)
    expect(dayKey(t)).toBe('2026-11-12')
    expect(secondsToNextDay(t)).toBe(30)
    expect(dayKey(t + 30_000)).toBe('2026-11-13')
  })
})

describe('counters', () => {
  it('count in the Cache API when that is all there is', async () => {
    const cache = fakeCache()
    const c = storeCounters(cacheStorage(cache, 'https://x.test'), { mirror: new Map() })
    expect(c.kind).toBe('cache')
    expect(await c.get('n')).toBe(0)
    expect(await c.add('n', 1, 60)).toBe(1)
    expect(await c.add('n', 2, 60)).toBe(3)
    // Another isolate in the same data centre sees the count through the cache.
    const other = storeCounters(cacheStorage(cache, 'https://x.test'), { mirror: new Map() })
    expect(await other.get('n')).toBe(3)
  })

  it('never go down when the store lags or loses a write (the in-memory guard)', async () => {
    const cache = fakeCache()
    const mirror = new Map()
    const c = storeCounters(cacheStorage(cache, 'https://x.test'), { mirror })
    await c.add('n', 5, 60)
    cache.entries.clear()
    expect(await c.get('n')).toBe(5)
    expect(await c.add('n', 1, 60)).toBe(6)
  })

  it('expire with their time to live', async () => {
    let now = 0
    const clock = () => now
    const c = storeCounters(cacheStorage(fakeCache(clock), 'https://x.test'), { mirror: new Map(), now: clock })
    await c.add('n', 4, 60)
    now = 61_000
    expect(await c.get('n')).toBe(0)
  })

  it('maxCounters: the highest count anywhere wins and is written everywhere', async () => {
    const kv = fakeKv()
    const cache = fakeCache()
    const a = storeCounters(kvStorage(kv), { mirror: new Map() })
    const b = storeCounters(cacheStorage(cache, 'https://x.test'), { mirror: new Map() })
    await b.set('n', 7, 60)
    const m = maxCounters(a, b)
    expect(await m.get('n')).toBe(7)
    expect(await m.add('n', 1, 60)).toBe(8)
    expect(kv.data.get('n')).toBe('8')
    // KV failing does not lose the count: the cache still has it.
    kv.failing = true
    expect(await maxCounters(storeCounters(kvStorage(kv), { mirror: new Map() }), storeCounters(cacheStorage(cache, 'https://x.test'), { mirror: new Map() })).get('n')).toBe(8)
  })

  it('syncedCounters: one KV write per ten additions, and a total that includes what is not written yet', async () => {
    const kv = fakeKv()
    const cache = fakeCache()
    const c = syncedCounters(storeCounters(kvStorage(kv), { mirror: new Map() }), cacheStorage(cache, 'https://x.test'), { every: 10, pending: new Map(), totals: new Map() })
    for (let i = 1; i <= 9; i++) expect(await c.add('n', 1, 60)).toBe(i)
    expect(kv.writes).toBe(0)
    expect(await c.get('n')).toBe(9)
    expect(await c.add('n', 1, 60)).toBe(10)
    expect(kv.writes).toBe(1)
    expect(kv.data.get('n')).toBe('10')
    expect(await c.add('n', 1, 60)).toBe(11)
    for (let i = 0; i < 25; i++) await c.add('n', 1, 60)
    expect(await c.get('n')).toBe(36)
    expect(kv.writes).toBe(3)
  })

  it('syncedCounters: a second isolate picks up the data centre’s unwritten count from the cache', async () => {
    const kv = fakeKv()
    const cache = fakeCache()
    const one = syncedCounters(storeCounters(kvStorage(kv), { mirror: new Map() }), cacheStorage(cache, 'https://x.test'), { pending: new Map(), totals: new Map() })
    for (let i = 0; i < 4; i++) await one.add('n', 1, 60)
    const two = syncedCounters(storeCounters(kvStorage(kv), { mirror: new Map() }), cacheStorage(cache, 'https://x.test'), { pending: new Map(), totals: new Map() })
    expect(await two.get('n')).toBe(4)
    expect(await two.add('n', 1, 60)).toBe(5)
  })

  it('syncedCounters: KV is read rarely, and afresh before each write so other data centres’ counts are kept', async () => {
    let now = 1_000_000
    const kv = fakeKv()
    let reads = 0
    const counting = { ...kv, get: async (k: string) => (reads++, kv.get(k)) }
    const make = (cache: ReturnType<typeof fakeCache>) => syncedCounters(storeCounters(kvStorage(counting), { mirror: new Map(), now: () => now }), cacheStorage(cache, 'https://x.test'), { every: 10, pending: new Map(), totals: new Map(), now: () => now })
    const chicago = make(fakeCache(() => now))
    for (let i = 0; i < 9; i++) await chicago.get('n')
    for (let i = 0; i < 9; i++) await chicago.add('n', 1, 600)
    expect(reads).toBe(1)
    // Meanwhile another data centre has written 40.
    kv.data.set('n', '40')
    expect(await chicago.add('n', 1, 600)).toBe(50)
    expect(kv.data.get('n')).toBe('50')
    // After a while the memo is refreshed.
    kv.data.set('n', '70')
    now += 21_000
    expect(await chicago.get('n')).toBe(70)
  })

  it('picks KV when it is bound and the cache otherwise', async () => {
    const cache = fakeCache()
    const without = edgeStores({}, cache, 'https://x.test')
    expect(without.kv).toBeNull()
    expect(busyCounters(without).kind).toBe('cache')
    expect(exactCounters(without).kind).toBe('cache')
    expect(durableStore(without).kind).toBe('cache')
    const withKv = edgeStores({ AI_KV: fakeKv() }, cache, 'https://x.test')
    expect(busyCounters(withKv).kind).toBe('kv')
    expect(exactCounters(withKv).kind).toBe('kv')
    expect(durableStore(withKv).kind).toBe('kv')
    // A variable that merely has the binding's name is not a namespace.
    expect(edgeStores({ AI_KV: 'oops' }, cache, 'https://x.test').kv).toBeNull()
  })
})
