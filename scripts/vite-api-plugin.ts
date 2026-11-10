/**
 * Vite dev-server middleware that mirrors the Cloudflare Pages Functions under
 * `functions/api/*`, so `npm run dev` works without Wrangler. Shares the same
 * handler modules so behaviour matches production.
 */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'
import { handleAircraftRequest, jsonResponse } from '../src/api/aircraftHandler'
import { allStations } from '../src/api/airports'
import { parseFlightQuery } from '../src/api/flightInfoHandler'
import { fetchFlightDetails } from '../src/api/flightSources'
import { handleFeedback, MAX_BODY } from '../src/api/feedbackHandler'
import { buildHealth } from '../src/api/healthHandler'
import { memoryCache } from '../src/api/sourceHealth'
import { aiStatus, parseSummarizeRequest, summarize } from '../src/api/summarizeHandler'
import { aiStatus as aiRunStatus, handleAiRun } from '../src/api/ai/handler'
import { optionsFromHeaders } from '../src/api/ai/run'
import { NOT_AVAILABLE } from '../src/api/transcribeHandler'
import { fetchWeather } from '../src/api/weatherHandler'

/** Stands in for the Cloudflare edge cache in dev. */
const devCache = memoryCache()

/** Data-source switches from the shell (`ATC_FAIL_SOURCES=adsb.fi npm run dev` rehearses failover). */
const sourceEnv = () => ({
  ATC_ENABLE_AIRPLANES_LIVE: process.env.ATC_ENABLE_AIRPLANES_LIVE,
  ATC_FAIL_SOURCES: process.env.ATC_FAIL_SOURCES,
})

/** AI config comes from the shell environment in dev (never from files in the repo). */
const aiEnv = () => ({
  AI_API_KEY: process.env.AI_API_KEY,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_MODEL: process.env.AI_MODEL,
})

function readBody(req: IncomingMessage, limit = 64_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c: Buffer) => {
      data += c.toString('utf8')
      if (data.length > limit) reject(new Error('body too large'))
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
            return await send(res, await handleAircraftRequest(airport, devCache, sourceEnv()))
          }

          if (url.pathname === '/api/health') {
            const opts = { env: sourceEnv(), cache: devCache, probeAll: url.searchParams.get('probe') === 'all' }
            return await send(res, jsonResponse(await buildHealth(airport, 'vite-dev', undefined, opts), 200, 'no-store'))
          }

          if (url.pathname === '/api/weather') {
            return await send(res, jsonResponse(await fetchWeather(airport, sourceEnv()), 200, 'public, max-age=60'))
          }

          if (url.pathname === '/api/flight') {
            const q = parseFlightQuery(url.searchParams.get('hex'), url.searchParams.get('callsign'))
            if (!q.hex && !q.callsign) return await send(res, jsonResponse({ error: 'hex or callsign required' }, 400, 'no-store'))
            return await send(res, jsonResponse(await fetchFlightDetails(q.hex, q.callsign, devCache), 200, 'public, max-age=600'))
          }

          if (url.pathname === '/api/ai') {
            const opts = optionsFromHeaders((n) => (req.headers[n] as string | undefined) ?? null)
            const env = { ...aiEnv(), ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY }
            if (req.method === 'GET') return await send(res, jsonResponse(aiRunStatus(env, opts), 200, 'no-store'))
            let body: unknown
            try {
              body = JSON.parse(await readBody(req))
            } catch {
              return await send(res, jsonResponse({ ok: false, error: 'bad request', status: 400 }, 400, 'no-store'))
            }
            const out = await handleAiRun(body, env, opts)
            return await send(res, jsonResponse(out, out.ok ? 200 : out.status, 'no-store'))
          }

          if (url.pathname === '/api/feedback' && req.method === 'POST') {
            const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, GITHUB_FEEDBACK_TOKEN: process.env.GITHUB_FEEDBACK_TOKEN, GITHUB_FEEDBACK_REPO: process.env.GITHUB_FEEDBACK_REPO, GITHUB_FEEDBACK_SCREENSHOT_BRANCH: process.env.GITHUB_FEEDBACK_SCREENSHOT_BRANCH }
            const out = await handleFeedback(await readBody(req, MAX_BODY), env, req.socket.remoteAddress ?? 'local')
            return await send(res, jsonResponse(out.body, out.status, 'no-store'))
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
