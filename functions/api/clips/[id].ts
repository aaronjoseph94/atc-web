/**
 * GET /api/clips/:id
 *
 * Serves a clip pack manifest. The manifest and audio live in the static
 * asset bundle (`public/clips/<id>/`); this route reads the manifest through
 * the Pages `ASSETS` binding so the id can be validated and headers set.
 * Any clip folder that ships a manifest is served; there is no separate
 * allow-list to keep in sync.
 */
import { jsonResponse } from '../../../src/api/aircraftHandler'
import type { ClipPack } from '../../../src/api/types'

/** Clip ids are folder names: lowercase words joined by hyphens. */
const CLIP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

type Env = { ASSETS: { fetch: (req: Request | string) => Promise<Response> } }

export const onRequestGet: PagesFunction<Env> = async ({ params, request, env }) => {
  const id = String(params.id ?? '')
  if (!CLIP_ID.test(id) || id.length > 64) return jsonResponse({ error: 'not found' }, 404, 'no-store')

  const manifestUrl = new URL(`/clips/${id}/manifest.json`, request.url)
  const res = await env.ASSETS.fetch(new Request(manifestUrl.toString()))
  // Unknown ids fall through to the SPA shell (HTML) or a 404; both mean "no such clip".
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
    return jsonResponse({ error: 'not found' }, 404, 'no-store')
  }

  const pack = (await res.json()) as ClipPack
  return jsonResponse(pack, 200, 'public, max-age=3600')
}
