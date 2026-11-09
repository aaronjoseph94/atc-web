/**
 * Backend diagnostics shared by the Pages Function and the dev middleware.
 * Runs one real provider round-trip so the Settings page can show which
 * free feed is answering and how fast.
 */
import { fetchAircraftForAirport } from './aircraftHandler'
import type { Health } from './client'

export async function buildHealth(airport: string, runtime: string, region?: string): Promise<Health> {
  const t0 = Date.now()
  try {
    const { aircraft, provider } = await fetchAircraftForAirport(airport)
    return {
      ok: true,
      provider,
      aircraft: aircraft.length,
      latencyMs: Date.now() - t0,
      runtime,
      region,
      checkedAt: new Date().toISOString(),
    }
  } catch (err) {
    return {
      ok: false,
      provider: null,
      aircraft: 0,
      latencyMs: Date.now() - t0,
      runtime,
      region,
      error: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
    }
  }
}
