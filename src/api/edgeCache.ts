/**
 * `JsonCache` on top of the Cloudflare Cache API (`caches.default`), so every
 * request served by a colo shares the same upstream answers. Kept free of
 * Workers types so the app and dev builds can import the module too.
 */
import type { JsonCache } from './sourceHealth'

/** The two Cache API methods we use. */
export type CacheLike = {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

/**
 * Keys become synthetic same-origin URLs under `/__cache/`; the Cache API only
 * stores GET responses with a `max-age`, which is how the TTL is applied.
 * `waitUntil` lets the write finish after the response has gone out.
 */
export function cacheApiJson(cache: CacheLike, origin: string, waitUntil?: (p: Promise<unknown>) => void): JsonCache {
  const req = (key: string) => new Request(`${origin}/__cache/${encodeURIComponent(key)}`, { method: 'GET' })
  return {
    async get<T>(key: string) {
      try {
        const hit = await cache.match(req(key))
        return hit ? ((await hit.json()) as T) : undefined
      } catch {
        return undefined
      }
    },
    async put(key, value, ttlSeconds) {
      const res = new Response(JSON.stringify(value), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${Math.max(1, Math.round(ttlSeconds))}` },
      })
      const p = cache.put(req(key), res).catch(() => {})
      if (waitUntil) waitUntil(p)
      else await p
    },
  }
}
