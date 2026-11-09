/**
 * Browser-side API client. All endpoints are same-origin `/api/*` routes
 * served by Cloudflare Pages Functions in production and by the Vite
 * middleware in development.
 */
import type { AiStatus, SummarizeRequest, SummarizeResponse } from './summarizeHandler'
import type { Aircraft, ClipPack, Station } from './types'

/** Diagnostics payload returned by `/api/health`. */
export type Health = {
  ok: boolean
  provider: string | null
  aircraft: number
  latencyMs: number
  runtime: string
  region?: string
  error?: string
  checkedAt: string
}

async function getJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${what} fetch failed (${res.status})`)
  return (await res.json()) as T
}

export function getAircraft(airport = 'ORD'): Promise<Aircraft[]> {
  return getJson(`/api/aircraft?airport=${encodeURIComponent(airport)}`, 'aircraft')
}

export function getStations(): Promise<Station[]> {
  return getJson('/api/stations', 'stations')
}

export function getHealth(airport = 'ORD'): Promise<Health> {
  return getJson(`/api/health?airport=${encodeURIComponent(airport)}`, 'health')
}

/** Whether the server has an AI provider configured (never exposes the key). */
export function getAiStatus(): Promise<AiStatus> {
  return getJson('/api/summarize', 'AI status')
}

/** Plain-English summary of a flight's recent radio calls (AI or rules). */
export async function summarizeTransmissions(req: SummarizeRequest): Promise<SummarizeResponse> {
  const res = await fetch('/api/summarize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(`summary failed (${res.status})`)
  return (await res.json()) as SummarizeResponse
}

/**
 * Load a clip pack. Falls back to the static manifest under `/clips/` so
 * playback keeps working even if the Function route is unavailable.
 */
export async function getClip(id: string): Promise<ClipPack> {
  const safe = encodeURIComponent(id)
  try {
    return await getJson<ClipPack>(`/api/clips/${safe}`, 'clip')
  } catch {
    return getJson<ClipPack>(`/clips/${safe}/manifest.json`, 'clip manifest')
  }
}
