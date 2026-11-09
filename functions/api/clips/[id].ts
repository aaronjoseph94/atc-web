import { jsonResponse } from '../../../src/api/aircraftHandler'
import type { ClipPack } from '../../../src/api/types'

/** Manifest only — audio lives under /clips/... as static assets. */
const CLIP_META: Record<string, Omit<ClipPack, 'cues' | 'tracks'> & { manifestPath: string }> = {
  'ord-tower-demo': {
    id: 'ord-tower-demo',
    stationId: 'ord-tower-28r',
    audioUrl: '/clips/ord-tower-demo/audio.wav',
    durationMs: 45000,
    title: 'ORD Tower demo',
    manifestPath: '/clips/ord-tower-demo/manifest.json',
  },
}

type PagesContext = {
  params: { id: string }
  request: Request
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const id = context.params.id
  const meta = CLIP_META[id]
  if (!meta) {
    return jsonResponse({ error: 'not found' }, 404, 'no-store')
  }

  // Prefer bundling full pack statically; function returns redirect-style meta + fetch path
  try {
    const origin = new URL(context.request.url).origin
    const res = await fetch(`${origin}${meta.manifestPath}`)
    if (res.ok) {
      const pack = (await res.json()) as ClipPack
      return jsonResponse(pack, 200, 'public, max-age=3600')
    }
  } catch {
    /* fall through */
  }

  return jsonResponse(
    {
      id: meta.id,
      stationId: meta.stationId,
      audioUrl: meta.audioUrl,
      durationMs: meta.durationMs,
      title: meta.title,
      cues: [],
      tracks: {},
    } satisfies ClipPack,
    200,
    'public, max-age=60',
  )
}
