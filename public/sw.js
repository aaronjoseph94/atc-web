/*
 * Service worker: makes the app installable and caches the heavy, immutable
 * assets (map tiles, glyphs, imagery, replay clips, airline logos) so revisits
 * are fast and work with a flaky connection.
 *
 * Deliberately NOT cached: the app shell (Vite emits hashed URLs; the HTML
 * must stay fresh) and `/api/*` (live data).
 */
const VERSION = 'v3'
const TILES = `atc-tiles-${VERSION}`
const CLIPS = `atc-clips-${VERSION}`
// Bump when scripts/fetch-airline-logos.py rebuilds the logo set, so changed files are refetched.
const LOGOS = 'atc-logos-v1'
const KNOWN = new Set([TILES, CLIPS, LOGOS])

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
    // The tile index is unversioned → network first so new tile sets are picked up.
    // Tiles and glyphs carry version paths → cache first.
    event.respondWith(url.pathname === '/planet' ? networkFirst(TILES, request) : cacheFirst(TILES, request))
    return
  }
  // Aerial imagery and chart tiles change rarely; radar and anything else stays live.
  if (url.hostname === 'basemap.nationalmap.gov' || url.hostname === 'tiles.arcgis.com') {
    event.respondWith(cacheFirst(TILES, request))
    return
  }
  if (url.origin === self.location.origin && url.pathname.startsWith('/clips/')) {
    // The clip catalogue can change between deploys; audio and manifests are replaced wholesale.
    event.respondWith(url.pathname.endsWith('/index.json') ? networkFirst(CLIPS, request) : cacheFirst(CLIPS, request))
    return
  }
  if (url.origin === self.location.origin && url.pathname.startsWith('/airline-logos/')) {
    event.respondWith(url.pathname.endsWith('/index.json') ? networkFirst(LOGOS, request) : cacheFirst(LOGOS, request))
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
