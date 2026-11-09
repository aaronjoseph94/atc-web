/*
 * Service worker: makes the app installable and caches the heavy, immutable
 * assets (map tiles, glyphs, sprites, demo clips) so revisits are fast and
 * work with a flaky connection.
 *
 * Deliberately NOT cached: the app shell (Vite emits hashed URLs; the HTML
 * must stay fresh) and `/api/*` (live data).
 */
const VERSION = 'v2'
const TILES = `atc-tiles-${VERSION}`
const CLIPS = `atc-clips-${VERSION}`
const KNOWN = new Set([TILES, CLIPS])

self.addEventListener('install', () => self.skipWaiting())

// Drop caches from older versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KNOWN.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (url.hostname.endsWith('openfreemap.org')) {
    // Style JSON is unversioned → network first so recolouring/layout changes land.
    // Tiles, glyphs and sprites carry version paths → cache first.
    const isStyle = url.pathname.startsWith('/styles/') || url.pathname === '/planet'
    event.respondWith(isStyle ? networkFirst(TILES, request) : cacheFirst(TILES, request))
    return
  }
  if (url.origin === self.location.origin && url.pathname.startsWith('/clips/')) {
    event.respondWith(cacheFirst(CLIPS, request))
  }
})

async function cacheFirst(name, request) {
  const cache = await caches.open(name)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) cache.put(request, res.clone())
  return res
}

async function networkFirst(name, request) {
  const cache = await caches.open(name)
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
  } catch (err) {
    const hit = await cache.match(request)
    if (hit) return hit
    throw err
  }
}
