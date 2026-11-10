/**
 * A radio dial along the foot of the flight card: one long tick per published
 * frequency at the airport, short ticks between, and a bright needle in the
 * middle on the channel you are listening to. Drag (or flick) the scale to
 * tune to a neighbouring channel, tap a frequency to jump to it, or use the
 * arrow keys. Tuning starts that channel's live audio when a feed carries it.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { formatMhz } from '../api/airportData'
import { getAirport, resolveStation } from '../api/airports'
import { tuneRadio } from '../live/radio/useLiveRadio'
import { usePlayhead } from '../playback/playheadStore'
import { haptic } from '../ui/haptics'
import { GAP, settle, tunerStops } from './tuner'

/** Short ticks between two channels. */
const MINOR = 5

export function FrequencyTuner() {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const setStationId = usePlayhead((s) => s.setStationId)
  const airport = getAirport(airportIcao)
  const stops = tunerStops(airport.stations)
  const current = resolveStation(airport, stationId)
  const at = Math.max(
    0,
    stops.findIndex((s) => s.id === current?.id || (current?.frequencyMhz != null && s.frequencyMhz === current.frequencyMhz)),
  )

  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; t: number; id: number; moved: boolean } | null>(null)
  // The channel under the needle while dragging, so each detent crossed can tick once.
  const detent = useRef(-1)

  if (stops.length < 2) return null

  const tune = (i: number, felt = false) => {
    const s = stops[Math.max(0, Math.min(stops.length - 1, i))]
    if (!s || s.id === current?.id) return
    if (!felt) haptic('tick')
    setStationId(s.id)
    // Called from the pointer or key handler, so the browser allows the audio to start.
    tuneRadio(s)
  }

  const down = (e: ReactPointerEvent) => {
    start.current = { x: e.clientX, t: e.timeStamp, id: e.pointerId, moved: false }
  }
  const move = (e: ReactPointerEvent) => {
    const s = start.current
    if (!s || e.pointerId !== s.id) return
    const d = e.clientX - s.x
    if (!s.moved && Math.abs(d) < 4) return
    if (!s.moved) {
      s.moved = true
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)
      detent.current = at
    }
    // Past either end the dial resists.
    const pos = at - d / GAP
    // A tick each time another channel's mark passes under the needle, like a detented knob.
    const under = Math.max(0, Math.min(stops.length - 1, Math.round(pos)))
    if (under !== detent.current) {
      detent.current = under
      haptic('tick')
    }
    const over = pos < 0 ? pos : pos > stops.length - 1 ? pos - (stops.length - 1) : 0
    setDx(d + over * GAP * 0.7)
  }
  const up = (e: ReactPointerEvent) => {
    const s = start.current
    if (!s || e.pointerId !== s.id) return
    start.current = null
    if (!s.moved) return
    const d = e.clientX - s.x
    setDragging(false)
    setDx(0)
    const to = settle(at, d, d / Math.max(1, e.timeStamp - s.t), stops.length)
    // The last detent crossed already ticked; a flick that carries further ticks on landing.
    tune(to, to === detent.current)
  }
  const key = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
    if (e.key === 'Home') tune(0)
    else if (e.key === 'End') tune(stops.length - 1)
    else if (step) tune(at + step)
    else return
    e.preventDefault()
  }

  // Ticks are drawn a few channels beyond each end so the dial never looks cut off.
  const ticks: { x: number; major: boolean }[] = []
  for (let i = -2; i <= stops.length + 1; i++) {
    for (let k = 0; k < MINOR + 1; k++) ticks.push({ x: (i + k / (MINOR + 1)) * GAP, major: k === 0 && i >= 0 && i < stops.length })
  }
  const offset = -at * GAP + dx
  const label = current ? `${current.label}${current.frequencyMhz != null ? ` ${formatMhz(current.frequencyMhz)}` : ''}` : 'Channel'

  return (
    <div className="pb-1 pt-1">
      <div
        data-no-drag
        role="slider"
        tabIndex={0}
        aria-label="Frequency"
        aria-valuemin={0}
        aria-valuemax={stops.length - 1}
        aria-valuenow={at}
        aria-valuetext={label}
        title={label}
        className="relative mx-auto h-12 max-w-md cursor-grab touch-pan-y select-none overflow-hidden rounded-lg outline-offset-0 active:cursor-grabbing"
        style={{ maskImage: 'linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent)' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        <div
          className="absolute left-1/2 top-0 h-full"
          style={{ transform: `translateX(${offset}px)`, transition: dragging ? 'none' : 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)' }}
        >
          {ticks.map((t) => (
            <span
              key={t.x}
              aria-hidden
              className={`absolute top-2 w-[2px] -translate-x-1/2 rounded-full ${t.major ? 'h-4 bg-white/75' : 'mt-1 h-2 bg-white/30'}`}
              style={{ left: t.x }}
            />
          ))}
          {stops.map((s, i) => (
            <button
              key={s.id}
              type="button"
              tabIndex={-1}
              aria-label={`Tune to ${s.label} ${formatMhz(s.frequencyMhz!)}`}
              className={`absolute top-7 -translate-x-1/2 whitespace-nowrap px-1 font-mono text-[11px] font-semibold tabular-nums tracking-wide transition-colors ${i === at && !dragging ? 'text-white' : 'text-white/45 hover:text-white/80'}`}
              style={{ left: i * GAP }}
              onClick={() => tune(i)}
            >
              {formatMhz(s.frequencyMhz!)}
            </button>
          ))}
        </div>
        {/* The needle stays put; the scale moves under it. */}
        <span aria-hidden className="pointer-events-none absolute left-1/2 top-0.5 h-[1.65rem] w-[3px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
      </div>
      <p className="mt-0.5 truncate px-4 text-center text-[11px] font-medium text-white/60">{current?.label ?? ''}</p>
    </div>
  )
}
