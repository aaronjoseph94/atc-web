/**
 * Browser-side API client. All endpoints are same-origin `/api/*` routes
 * served by Cloudflare Pages Functions in production and by the Vite
 * middleware in development.
 */
import type { SourceStatus } from './sourceHealth'
import type { AiStatus, SummarizeRequest, SummarizeResponse } from './summarizeHandler'
import type { Aircraft, AircraftSnapshot, ClipPack, ClipSummary, FlightInfo, Station, Weather } from './types'

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
  /** Every upstream source (ADS-B, metadata, weather) with its own status. */
  sources?: SourceStatus[]
}

async function getJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${what} fetch failed (${res.status})`)
  return (await res.json()) as T
}

/**
 * Live traffic near an airport. The body is the aircraft list; which feed
 * answered (or why none did) travels in response headers so an empty sky can
 * be told apart from a broken feed.
 */
export async function getAircraft(airport = 'ORD'): Promise<AircraftSnapshot> {
  const res = await fetch(`/api/aircraft?airport=${encodeURIComponent(airport)}`)
  if (!res.ok) throw new Error(`aircraft fetch failed (${res.status})`)
  const error = res.headers.get('X-Upstream-Error')
  const aircraft = (await res.json()) as Aircraft[]
  if (error && aircraft.length === 0) throw new Error(error)
  return { aircraft, provider: res.headers.get('X-Provider'), error }
}

/** Current METAR and, where published, the digital ATIS for an airport. */
export function getWeather(airport = 'ORD'): Promise<Weather> {
  return getJson(`/api/weather?airport=${encodeURIComponent(airport)}`, 'weather')
}

/** Scheduled route and airframe details for one flight. */
export function getFlightInfo(hex: string | null, callsign: string | null): Promise<FlightInfo> {
  const q = new URLSearchParams()
  if (hex) q.set('hex', hex)
  if (callsign) q.set('callsign', callsign)
  return getJson(`/api/flight?${q.toString()}`, 'flight info')
}

/** Catalog of bundled playback clips (static JSON, cached by the service worker). */
export async function getClipIndex(): Promise<ClipSummary[]> {
  const data = await getJson<{ clips?: ClipSummary[] }>('/clips/index.json', 'clip index')
  return data.clips ?? []
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
