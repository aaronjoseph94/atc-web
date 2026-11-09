import type { Plugin } from 'vite'
import { fetchAircraftForAirport, jsonResponse } from '../src/api/aircraftHandler'
import { STATIONS } from '../src/api/stations'
import type { Aircraft } from '../src/api/types'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Local `/api/*` middleware so `vite` works without wrangler. */
export function apiDevPlugin(): Plugin {
  return {
    name: 'atc-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        try {
          if (url.startsWith('/api/aircraft')) {
            const u = new URL(url, 'http://localhost')
            const airport = u.searchParams.get('airport') ?? 'ORD'
            let aircraft: Aircraft[] = []
            try {
              aircraft = await fetchAircraftForAirport(airport)
            } catch {
              aircraft = []
            }
            const r = jsonResponse(aircraft)
            res.statusCode = r.status
            r.headers.forEach((v: string, k: string) => res.setHeader(k, v))
            res.end(await r.text())
            return
          }
          if (url.startsWith('/api/stations')) {
            const r = jsonResponse(STATIONS, 200, 'public, max-age=3600')
            res.statusCode = r.status
            r.headers.forEach((v: string, k: string) => res.setHeader(k, v))
            res.end(await r.text())
            return
          }
          const clipMatch = url.match(/^\/api\/clips\/([^/?]+)/)
          if (clipMatch) {
            const id = clipMatch[1]
            const file = path.resolve(
              server.config.root,
              'public/clips',
              id,
              'manifest.json',
            )
            try {
              const raw = await readFile(file, 'utf8')
              res.setHeader('Content-Type', 'application/json')
              res.setHeader('Cache-Control', 'public, max-age=3600')
              res.end(raw)
            } catch {
              res.statusCode = 404
              res.end(JSON.stringify({ error: 'not found' }))
            }
            return
          }
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(e) }))
          return
        }
        next()
      })
    },
  }
}
