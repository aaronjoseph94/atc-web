/**
 * GET /api/clips/:id
 *
 * Serves a clip pack manifest. The manifest and audio live in the static
 * asset bundle (`public/clips/<id>/`); this route reads the manifest through
 * the Pages `ASSETS` binding so the id can be validated and headers set.
 */
import { jsonResponse } from '../../../src/api/aircraftHandler'
import type { ClipPack } from '../../../src/api/types'

/** Allow-list of bundled clips. */
const CLIPS = new Set(['ord-tower-demo'])

type Env = { ASSETS: { fetch: (req: Request | string) => Promise<Response> } }

export const onRequestGet: PagesFunction<Env> = async ({ params, request, env }) => {
  const id = String(params.id ?? '')
  if (!CLIPS.has(id)) return jsonResponse({ error: 'not found' }, 404, 'no-store')

  const manifestUrl = new URL(`/clips/${id}/manifest.json`, request.url)
  const res = await env.ASSETS.fetch(new Request(manifestUrl.toString()))
  if (!res.ok) return jsonResponse({ error: 'manifest missing' }, 500, 'no-store')

  const pack = (await res.json()) as ClipPack
  return jsonResponse(pack, 200, 'public, max-age=3600')
}
