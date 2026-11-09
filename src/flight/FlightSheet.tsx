import { Plane, X } from 'lucide-react'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAircraft } from '../api/client'
import { getActiveCue, interpolateTrack } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'

export function FlightSheet() {
  const open = usePlayhead((s) => s.sheetOpen)
  const selectedIcao = usePlayhead((s) => s.selectedIcao)
  const mode = usePlayhead((s) => s.mode)
  const clip = usePlayhead((s) => s.clip)
  const tMs = usePlayhead((s) => s.tMs)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const setSheetOpen = usePlayhead((s) => s.setSheetOpen)

  const { data: live } = useQuery({
    queryKey: ['aircraft', airportIcao],
    queryFn: () => getAircraft(airportIcao),
    enabled: mode === 'live' && open,
    staleTime: 8000,
  })

  const detail = useMemo(() => {
    if (!selectedIcao) return null
    if (mode === 'playback' && clip) {
      const key = Object.keys(clip.tracks).find(
        (k) => k.toLowerCase() === selectedIcao.toLowerCase(),
      )
      if (!key) return null
      const p = interpolateTrack(clip.tracks[key], tMs)
      const cue = getActiveCue(clip.cues, tMs)
      return {
        callsign: key,
        altitudeFt: p?.altitudeFt ?? null,
        speedKt: p?.speedKt ?? null,
        heading: p?.heading ?? 0,
        onGround: (p?.altitudeFt ?? 0) < 50,
        now: cue?.text,
      }
    }
    const ac = live?.find((a) => a.icao24 === selectedIcao)
    if (!ac) return null
    const cue = clip ? getActiveCue(clip.cues, tMs) : null
    return {
      callsign: ac.callsign,
      altitudeFt: ac.altitudeFt,
      speedKt: ac.speedKt,
      heading: ac.heading,
      onGround: ac.onGround,
      now: cue?.text,
    }
  }, [selectedIcao, mode, clip, tMs, live])

  if (!open) return null

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center px-2 pb-[calc(6.5rem+var(--safe-bottom))]">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#12161f]/95 shadow-2xl backdrop-blur-md">
        <div className="flex items-start justify-between gap-3 px-4 pt-3">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-atc-yellow/20 p-2 text-atc-yellow">
              <Plane className="size-5" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-wide">{detail?.callsign ?? '—'}</div>
              <div className="text-xs text-white/50">
                {detail?.onGround ? 'On ground' : 'Airborne'} · hdg {Math.round(detail?.heading ?? 0)}°
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close flight sheet"
            className="rounded-full bg-white/10 p-2"
            onClick={() => setSheetOpen(false)}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 px-4">
          <Stat label="Altitude" value={detail?.altitudeFt != null ? `${detail.altitudeFt.toLocaleString()} ft` : '—'} />
          <Stat label="Speed" value={detail?.speedKt != null ? `${detail.speedKt} kt` : '—'} />
        </div>
        <div className="mt-3 border-t border-white/10 px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-wider text-atc-purple">Now</div>
          <p className="mt-1 text-sm text-white/85">
            {detail?.now ?? 'No active transmission for this flight'}
          </p>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-white/45">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  )
}
