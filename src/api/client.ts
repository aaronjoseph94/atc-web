import type { Aircraft, ClipPack, Station } from './types'

export async function getAircraft(airport = 'ORD'): Promise<Aircraft[]> {
  const res = await fetch(`/api/aircraft?airport=${encodeURIComponent(airport)}`)
  if (!res.ok) throw new Error('aircraft fetch failed')
  return res.json()
}

export async function getStations(): Promise<Station[]> {
  const res = await fetch('/api/stations')
  if (!res.ok) throw new Error('stations fetch failed')
  return res.json()
}

export async function getClip(id: string): Promise<ClipPack> {
  const res = await fetch(`/api/clips/${encodeURIComponent(id)}`)
  if (!res.ok) {
    // Static fallback
    const m = await fetch(`/clips/${id}/manifest.json`)
    if (!m.ok) throw new Error('clip not found')
    return m.json()
  }
  return res.json()
}
