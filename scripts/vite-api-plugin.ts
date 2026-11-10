/**
 * Vite dev-server middleware that mirrors the Cloudflare Pages Functions under
 * `functions/api/*`, so `npm run dev` works without Wrangler. Shares the same
 * handler modules so behaviour matches production.
 */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'
import { fetchAircraftForAirport, jsonResponse } from '../src/api/aircraftHandler'
import { allStations } from '../src/api/airports'
import { fetchFlightInfo, parseFlightQuery } from '../src/api/flightInfoHandler'
import { buildHealth } from '../src/api/healthHandler'
import { aiStatus, parseSummarizeRequest, summarize } from '../src/api/summarizeHandler'
import { NOT_AVAILABLE } from '../src/api/transcribeHandler'
import { fetchWeather } from '../src/api/weatherHandler'

/** AI config comes from the shell environment in dev (never from files in the repo). */
const aiEnv = () => ({
  AI_API_KEY: process.env.AI_API_KEY,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_MODEL: process.env.AI_MODEL,
})

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c: Buffer) => {
      data += c.toString('utf8')
      if (data.length > 64_000) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/** Copy a `Response` onto Node's `ServerResponse`. */
async function send(res: ServerResponse, r: Response) {
  res.statusCode = r.status
  r.headers.forEach((v, k) => res.setHeader(k, v))
  res.end(await r.text())
}

export function apiDevPlugin(): Plugin {
  return {
    name: 'atc-api-dev',
    configureServer(server) {
      // Connect middleware is sync; wrap the async handler so rejections reach `next`.
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next).catch(next)
      })

      async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()

        try {
          const airport = (url.searchParams.get('airport') ?? 'ORD').toUpperCase()

          if (url.pathname === '/api/aircraft') {
            try {
              const { aircraft, provider } = await fetchAircraftForAirport(airport)
              const r = jsonResponse(aircraft)
              r.headers.set('X-Provider', provider)
              return await send(res, r)
            } catch (err) {
              const r = jsonResponse([], 200, 'no-store')
              r.headers.set('X-Upstream-Error', String(err instanceof Error ? err.message : err).slice(0, 300))
              return await send(res, r)
            }
          }

          if (url.pathname === '/api/health') {
            return await send(res, jsonResponse(await buildHealth(airport, 'vite-dev'), 200, 'no-store'))
          }

          if (url.pathname === '/api/weather') {
            return await send(res, jsonResponse(await fetchWeather(airport), 200, 'public, max-age=60'))
          }

          if (url.pathname === '/api/flight') {
            const q = parseFlightQuery(url.searchParams.get('hex'), url.searchParams.get('callsign'))
            if (!q.hex && !q.callsign) return await send(res, jsonResponse({ error: 'hex or callsign required' }, 400, 'no-store'))
            return await send(res, jsonResponse(await fetchFlightInfo(q.hex, q.callsign), 200, 'public, max-age=600'))
          }

          if (url.pathname === '/api/summarize') {
            if (req.method === 'GET') return await send(res, jsonResponse(aiStatus(aiEnv()), 200, 'no-store'))
            try {
              const parsed = parseSummarizeRequest(JSON.parse(await readBody(req)))
              return await send(res, jsonResponse(await summarize(parsed, aiEnv()), 200, 'no-store'))
            } catch (err) {
              return await send(res, jsonResponse({ error: err instanceof Error ? err.message : 'bad request' }, 400, 'no-store'))
            }
          }

          // Speech to text runs on Workers AI, which only exists on the deployed site.
          if (url.pathname === '/api/transcribe') {
            req.resume()
            return await send(res, jsonResponse({ error: NOT_AVAILABLE, code: 'no-ai' }, 501, 'no-store'))
          }

          if (url.pathname === '/api/stations') {
            return await send(res, jsonResponse(allStations(), 200, 'public, max-age=3600'))
          }

          const clip = url.pathname.match(/^\/api\/clips\/([\w-]+)$/)
          if (clip) {
            const file = path.resolve(server.config.root, 'public/clips', clip[1], 'manifest.json')
            try {
              const raw = await readFile(file, 'utf8')
              return await send(res, jsonResponse(JSON.parse(raw), 200, 'public, max-age=3600'))
            } catch {
              return await send(res, jsonResponse({ error: 'not found' }, 404, 'no-store'))
            }
          }

          return await send(res, jsonResponse({ error: 'not found' }, 404, 'no-store'))
        } catch (e) {
          return await send(res, jsonResponse({ error: String(e) }, 500, 'no-store'))
        }
      }
    },
  }
}
