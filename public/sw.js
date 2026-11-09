/* Minimal installable SW — precache shell; cache tiles/clips at runtime. */
const SHELL = 'atc-shell-v1'
const TILES = 'atc-tiles-v1'
const CLIPS = 'atc-clips-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(['/', '/index.html', '/manifest.webmanifest', '/favicon.svg'])),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.hostname.includes('openfreemap.org')) {
    event.respondWith(cacheFirst(TILES, event.request))
    return
  }
  if (url.pathname.startsWith('/clips/')) {
    event.respondWith(cacheFirst(CLIPS, event.request))
    return
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
