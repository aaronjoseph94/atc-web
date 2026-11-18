/**
 * POST /api/transcribe — one live radio transmission (16 kHz mono WAV) in,
 * `{ text, segments }` out, via Whisper on Cloudflare Workers AI.
 *
 * Needs the `AI` binding declared in wrangler.toml. Without it (a project
 * that hasn't picked the binding up yet) the endpoint answers 501 and the app
 * keeps playing audio without captions. Same-origin only, rate limited per
 * visitor, behind the Turnstile session when that is on, and capped site-wide
 * at TRANSCRIBE_DAILY_CAP a day (counted in AI_KV when bound, else per data
 * centre).
 */
import { handleTranscribe, type TranscribeEnv } from '../../src/api/transcribeHandler'
import { busyCounters, edgeStores } from '../../src/api/storage'

type Env = TranscribeEnv & { AI_KV?: KVNamespace }

export const onRequestPost: PagesFunction<Env> = ({ request, env, waitUntil }) => {
  const stores = edgeStores(env, caches.default, new URL(request.url).origin, waitUntil)
  return handleTranscribe(request, env, { counters: busyCounters(stores) })
}
