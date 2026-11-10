/**
 * The yellow station bar: airport code, airport name and the controller
 * position being followed. Tapping the code or name opens the airport
 * picker; tapping the position opens the channel switcher; the round button
 * plays the channel live (LiveATC). In playback the bar turns into the
 * replay timeline.
 */
import { ChevronRight, Wind } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatMhz } from '../api/airportData'
import { getAirport, resolveStation } from '../api/airports'
import { getWeather } from '../api/client'
import { analysers } from '../live/radio/audioGraph'
import { useRadio } from '../live/radio/radioStore'
import type { FlightCategory } from '../api/types'
import { Timeline } from '../playback/Timeline'
import { usePlayhead } from '../playback/playheadStore'
import { reducedMotion } from '../ui/motion'
import { RadioButton, RadioStatusLine } from './RadioButton'
import { Waveform } from './Waveform'

/** Flight-category colours as used on every aviation weather map. */
export const CATEGORY_COLOR: Record<FlightCategory, string> = { VFR: '#16A34A', MVFR: '#2563EB', IFR: '#DC2626', LIFR: '#C026D3' }

/** Weather for the current airport; shared cache entry for the bar and the weather panel. */
export function useWeather(airport: string) {
  return useQuery({ queryKey: ['weather', airport], queryFn: () => getWeather(airport), staleTime: 4 * 60_000, refetchInterval: 5 * 60_000, retry: 1 })
}

/** Level-meter smoothing per 60 fps frame: quick to light, slow to fade, so it glows with the voice rather than flickering on syllables. */
const ATTACK = 0.16
const RELEASE = 0.045

/**
 * How lit the airport code is (0..1) while someone transmits: the
 * segmenter's speech flag gates it, the analyser's loudness shapes it, and
 * it is smoothed like a meter. Written to `--tx` on the element directly, so
 * it costs no React renders. Runs only while the live radio plays.
 */
function useTransmitGlow(active: boolean) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!active) {
      el.style.setProperty('--tx', '0')
      return
    }
    let raf = 0
    let level = 0
    let last = performance.now()
    let buf: Float32Array<ArrayBuffer> | null = null
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const k = Math.min(3, (t - last) / 16.7)
      last = t
      const speaking = useRadio.getState().speaking
      let target = 0
      if (speaking) {
        const analyser = analysers.live
        if (analyser) {
          if (!buf || buf.length !== analyser.fftSize) buf = new Float32Array(analyser.fftSize)
          analyser.getFloatTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
          // Radio speech sits around 0.05..0.3 RMS; map that onto a gentle 0.45..1.
          target = Math.min(1, 0.45 + Math.sqrt(sum / buf.length) * 2.2)
        } else target = 0.6
      }
      if (reducedMotion()) level = speaking ? 0.4 : 0
      else level += (target - level) * (1 - (1 - (target > level ? ATTACK : RELEASE)) ** k)
      el.style.setProperty('--tx', level < 0.002 ? '0' : level.toFixed(3))
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      el.style.setProperty('--tx', '0')
    }
  }, [active])
  return ref
}

/**
 * While a call is on the air the code lifts a touch and a soft light blooms
 * behind the letters, like a lamp coming up behind a sign. Very subtle.
 */
const CODE_GLOW = {
  transform: 'scale(calc(1 + var(--tx, 0) * 0.025))',
  textShadow: '0 0 calc(var(--tx, 0) * 16px) rgba(255, 246, 214, calc(var(--tx, 0) * 0.95)), 0 0 calc(var(--tx, 0) * 34px) rgba(255, 240, 190, calc(var(--tx, 0) * 0.6))',
  color: 'color-mix(in oklab, #000 calc(100% - var(--tx, 0) * 22%), #5a3b00)',
} as const

export function StationBar() {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const mode = usePlayhead((s) => s.mode)
  const playing = usePlayhead((s) => s.playing)
  const clip = usePlayhead((s) => s.clip)
  const setPanel = usePlayhead((s) => s.setPanel)
  const radioLive = useRadio((s) => s.on && (s.status === 'live' || s.status === 'buffering'))
  const glow = useTransmitGlow(radioLive && mode === 'live')

  const airport = getAirport(airportIcao)
  const station = resolveStation(airport, stationId)
  const weather = useWeather(airportIcao).data?.metar
  const stationText = station ? `${station.label}${station.frequencyMhz != null ? ` ${formatMhz(station.frequencyMhz)}` : ''}` : 'Tower'

  if (mode === 'playback' && clip) {
    return (
      <div className="on-yellow pointer-events-auto w-full overflow-hidden rounded-t-[1.75rem] bg-atc-yellow text-black shadow-[0_-10px_30px_rgba(0,0,0,0.45)] md:w-[min(92vw,40rem)] md:rounded-[1.75rem] md:shadow-2xl">
        <Timeline clip={clip} label={clip.kind === 'rewind' ? `${airport.icao} traffic replay` : `${airport.icao} ${stationText}`} />
        {clip.audioUrl && <Waveform active={playing} source="replay" />}
      </div>
    )
  }

  return (
    <div className="on-yellow pointer-events-auto w-full overflow-hidden rounded-t-[1.75rem] bg-atc-yellow text-black shadow-[0_-10px_30px_rgba(0,0,0,0.45)] md:w-[min(92vw,40rem)] md:rounded-[1.75rem] md:shadow-2xl">
      <div className="flex items-center gap-3 px-4 pb-1 pt-3">
        <button
          type="button"
          className="shrink-0 rounded-lg font-display text-[3.4rem] leading-[0.95] tracking-tight transition active:scale-95"
          onClick={() => setPanel('airports')}
          aria-label={`Change airport. Showing ${airport.name}`}
        >
          <span ref={glow} className="inline-block origin-left" style={CODE_GLOW}>
            {airport.icao}
          </span>
        </button>

        <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
          <button type="button" className="max-w-full truncate rounded text-left text-[17px] font-bold leading-tight" onClick={() => setPanel('airports')} tabIndex={-1}>
            {airport.stations[0]?.name ?? airport.name}
          </button>
          <button
            type="button"
            className="flex max-w-full items-center gap-1 rounded-lg bg-black/10 py-1 pl-2 pr-1 text-sm font-semibold text-black/85 transition hover:bg-black/15 active:scale-[0.97]"
            onClick={() => setPanel('stations')}
            aria-label={`Switch channel. Following ${stationText}`}
          >
            <span className="truncate">{station?.label ?? 'Tower'}</span>
            <ChevronRight className="size-4 shrink-0" />
          </button>
        </div>

        {weather && (
          <button
            type="button"
            className="flex shrink-0 flex-col items-end gap-0.5 rounded-xl bg-black/10 px-2.5 py-1.5 text-right transition hover:bg-black/15 active:scale-95"
            onClick={() => setPanel('weather')}
            aria-label="Weather and ATIS"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-bold">
              {weather.flightCategory && <span className="size-2 rounded-full ring-1 ring-black/20" style={{ background: CATEGORY_COLOR[weather.flightCategory] }} />}
              {weather.flightCategory ?? 'Weather'}
            </span>
            <span className="flex items-center gap-1 text-xs font-semibold tabular-nums text-black/80">
              <Wind className="size-3.5" />
              {weather.windKt ? `${weather.windDirDeg != null ? `${String(weather.windDirDeg).padStart(3, '0')}°` : 'Vrb'} ${weather.windKt}${weather.gustKt ? `G${weather.gustKt}` : ''}` : 'Calm'}
            </span>
          </button>
        )}
        <RadioButton label={stationText} />
      </div>
      <RadioStatusLine />
      <div className="pb-[var(--safe-bottom)]">
        <Waveform active={radioLive} source="live" />
      </div>
    </div>
  )
}
