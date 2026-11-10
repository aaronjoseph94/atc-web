/**
 * POST /api/transcribe — one live radio transmission (16 kHz mono WAV) in,
 * `{ text, segments }` out, via Whisper on Cloudflare Workers AI.
 *
 * Needs the `AI` binding declared in wrangler.toml. Without it (a project
 * that hasn't picked the binding up yet) the endpoint answers 501 and the app
 * keeps playing audio without captions.
 */
import { handleTranscribe, type TranscribeEnv } from '../../src/api/transcribeHandler'

export const onRequestPost: PagesFunction<TranscribeEnv> = ({ request, env }) => handleTranscribe(request, env)
