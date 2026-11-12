/**
 * The optional AI line for a sighting: one call per type and airport (the
 * server caches it for a day), only for rows on screen, and only when AI is
 * set up on the server. Without AI the deterministic line stays.
 */
import { useQuery } from '@tanstack/react-query'
import { askAi, useAiReady } from '../ai/client'
import { getAirport } from '../api/airports'
import { parseExplainSighting, type ExplainSightingInput } from '../api/ai/tasks/explainSighting'
import { airportClass } from './rarity'
import type { Spot } from './spotter'

export { useAiReady }

/** What the AI is told: the type, the airport and the stable reasons (nothing about this session or flight). */
export function sightingInput(spot: Pick<Spot, 'type' | 'name' | 'airport' | 'reasons'>): ExplainSightingInput | null {
  if (!spot.type) return null
  return {
    type: spot.type,
    name: spot.name,
    airport: spot.airport,
    airportName: getAirport(spot.airport).name,
    airportClass: airportClass(spot.airport),
    reasons: spot.reasons.filter((r) => r.kind !== 'first-seen' && r.kind !== 'seen-often' && r.points > 0).map((r) => r.label),
  }
}

/** `{ line, ai }`: the AI's line when it has one, else the built-in one. */
export function useSightingLine(spot: Spot): { line: string; ai: boolean } {
  const ready = useAiReady()
  const input = sightingInput(spot)
  const q = useQuery({
    queryKey: ['explainSighting', input?.type, input?.airport, input?.reasons.join('|')],
    queryFn: async ({ signal }) => parseExplainSighting(await askAi('explainSighting', input, { signal })),
    enabled: ready && !!input,
    staleTime: Infinity,
    gcTime: 6 * 3_600_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
  return q.data ? { line: q.data.line, ai: true } : { line: spot.line, ai: false }
}
