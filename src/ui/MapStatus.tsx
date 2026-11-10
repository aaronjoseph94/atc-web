/**
 * The map's own voice when it has no traffic to draw: a radar sweep while
 * the first positions load, a quiet-airport scene when nobody is flying, and
 * a clear "feeds are down" card with a retry. Floats in the middle of the
 * map area, clear of the bottom stack, and never blocks the map around it.
 */
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getAirport } from '../api/airports'
import { usePlayhead } from '../playback/playheadStore'
import { useMap } from '../app/useMap'
import { mapStateFor, type MapState } from './mapStatusModel'
import { EmptyState, OfflineArt, QuietArt, RadarSweep, StateAction } from './States'
import { usePresence } from './usePresence'

export function MapStatus() {
  const map = useMap()
  const state = usePlayhead((s) => mapStateFor(s))
  const panel = usePlayhead((s) => s.panel)
  // Out of the way while a panel is open over the map.
  const show = state != null && !panel
  const { mounted, closing } = usePresence(show, 220)
  // Keep the last message while the card fades away.
  const [last, setLast] = useState<MapState>(state)
  if (state && state !== last) setLast(state)
  const shown = state ?? last
  if (!mounted || !shown) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 top-24 bottom-[calc(var(--bottom-stack,8rem)+1rem)] z-10 grid place-items-center px-4">
      <div
        key={shown}
        data-closing={closing ? '' : undefined}
        role="status"
        aria-live="polite"
        className={`motion-pop glass-pop pointer-events-auto rounded-[1.6rem] shadow-pop ring-1 ring-white/[0.1] ${shown === 'loading' ? 'flex items-center gap-4 py-3.5 pl-3.5 pr-5' : 'w-[min(100%,22rem)] px-5 py-5'}`}
      >
        {shown === 'loading' ? <Loading mapReady={!!map} /> : shown === 'quiet' ? <Quiet /> : <Offline />}
      </div>
    </div>
  )
}

function Loading({ mapReady }: { mapReady: boolean }) {
  const airport = getAirport(usePlayhead((s) => s.airportIcao))
  return (
    <>
      <RadarSweep size={56} />
      <div className="min-w-0">
        <p className="text-subhead font-semibold text-white">{mapReady ? 'Looking for traffic' : 'Loading the map'}</p>
        <p className="text-footnote text-white/65">{mapReady ? `Listening for aircraft around ${airport.icao}…` : `Drawing ${airport.name}…`}</p>
      </div>
    </>
  )
}

function Quiet() {
  const airport = getAirport(usePlayhead((s) => s.airportIcao))
  const setPanel = usePlayhead((s) => s.setPanel)
  return (
    <EmptyState
      compact
      art={<QuietArt className="mb-1 rounded-[22px] ring-1 ring-white/10" />}
      title={`All quiet at ${airport.icao}`}
      actions={
        <>
          <StateAction primary onClick={() => setPanel('replay')}>
            Watch a replay
          </StateAction>
          <StateAction onClick={() => setPanel('airports')}>Another airport</StateAction>
        </>
      }
    >
      Nothing is broadcasting its position near the airfield right now. Late at night that’s normal; new arrivals appear here on their own.
    </EmptyState>
  )
}

function Offline() {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const setPanel = usePlayhead((s) => s.setPanel)
  const queryClient = useQueryClient()
  const fetching = useIsFetching({ queryKey: ['aircraft', airportIcao] }) > 0
  return (
    <EmptyState
      compact
      art={<OfflineArt className="mb-1" />}
      title="Live traffic is offline"
      actions={
        <>
          <StateAction primary busy={fetching} onClick={() => void queryClient.invalidateQueries({ queryKey: ['aircraft', airportIcao] })}>
            {fetching ? 'Trying…' : 'Try again'}
          </StateAction>
          <StateAction onClick={() => setPanel('replay')}>Watch a replay</StateAction>
        </>
      }
    >
      The tracking feeds aren’t answering. The app keeps retrying by itself, and replays still work.
    </EmptyState>
  )
}
