/**
 * The aircraft, drawn: a large top view of its type on a dark blueprint
 * panel, with dimension lines for wingspan and length, then the type's facts
 * (engines, size, seats, range, cruise, first flight) and the airframe's
 * registration. The drawing is the same artwork the map uses for the icon.
 *
 * Unknown types fall back to the drawing for their class and show no numbers.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSettings } from '../settings/settingsStore'
import { formatCruise, formatLength, formatRange } from './format'
import { renderAircraft } from './render'
import { getShape } from './shapes'
import { aircraftProfile, describeEngines } from './types'

type Props = {
  /** ICAO type designator from the feed, e.g. "B738". */
  type: string | null | undefined
  /** ADS-B emitter category, used when the type is unknown. */
  category?: string | null
  registration?: string | null
  /** Airframe description from the registration database, e.g. "A321 231SL". */
  dbName?: string | null
  dbManufacturer?: string | null
}

/** Watches the reduced-motion preference (in-app setting or the OS). */
function useReducedMotion(): boolean {
  const setting = useSettings((s) => s.reduceMotion)
  const [os, setOs] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setOs(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return setting || os
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-white/50">{label}</dt>
      <dd className="truncate text-[15px] font-semibold tabular-nums leading-snug">{value}</dd>
    </div>
  )
}

export function AircraftPanel({ type, category, registration, dbName, dbManufacturer }: Props) {
  const altitudeUnit = useSettings((s) => s.altitudeUnit)
  const speedUnit = useSettings((s) => s.speedUnit)
  const reduced = useReducedMotion()
  const profile = aircraftProfile({ type, category, dbName, dbManufacturer })
  const shape = getShape(profile.shape)
  const facts = profile.facts
  const isHeli = profile.shape === 'ac-heli'

  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const art = useRef<HTMLDivElement>(null)
  const dims = useRef<SVGSVGElement>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)

  // Size the drawing to the panel.
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Leave room for the dimension lines below and to the right.
  const layout = box
    ? (() => {
        const padX = 52
        const top = 30
        const bottom = 42
        const ppm = Math.min((box.w - padX * 2) / shape.span, (box.h - top - bottom) / shape.length)
        return { ppm, w: shape.span * ppm, h: shape.length * ppm, cx: box.w / 2, cy: top + (box.h - top - bottom) / 2 }
      })()
    : null
  const ppm = layout?.ppm ?? null

  useEffect(() => {
    const c = canvas.current
    if (!c || ppm == null) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    // A little margin so the rounded edges and the rotor disc aren't clipped.
    const W = Math.ceil((shape.span * ppm + 24) * dpr)
    const H = Math.ceil((shape.length * ppm + 24) * dpr)
    c.width = W
    c.height = H
    c.style.width = `${W / dpr}px`
    c.style.height = `${H / dpr}px`
    const img = renderAircraft(shape, { width: W, height: H, ppm: ppm * dpr, tone: 'white', rotorAngle: Math.PI / 4 })
    c.getContext('2d')?.putImageData(img, 0, 0)
  }, [shape, ppm, canvas])

  // Entrance: the drawing settles in (fade, scale, a few degrees of turn), then the dimension lines draw.
  const ready = layout != null
  const animKey = `${profile.shape}:${type ?? ''}`
  useEffect(() => {
    if (reduced || !ready || !art.current) return
    // Replays when the type changes (another aircraft selected), not on every resize.
    art.current.dataset.shown = animKey
    const a = art.current.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.86) rotate(-9deg)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1.01) rotate(0.6deg)', offset: 0.7 },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1) rotate(0deg)' },
      ],
      { duration: 900, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    )
    const lines = dims.current ? Array.from(dims.current.querySelectorAll<SVGElement>('[data-draw]')) : []
    const anims = lines.map((l, i) =>
      l.animate([{ strokeDashoffset: 1, opacity: 0 }, { strokeDashoffset: 0, opacity: 1 }], { duration: 650, delay: 380 + i * 90, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }),
    )
    const labels = dims.current ? Array.from(dims.current.querySelectorAll<SVGElement>('[data-fade]')) : []
    const fades = labels.map((l) => l.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 760, fill: 'backwards' }))
    return () => {
      a.cancel()
      anims.forEach((x) => x.cancel())
      fades.forEach((x) => x.cancel())
    }
  }, [animKey, reduced, ready])

  const spanM = facts?.spanM
  const lengthM = facts?.lengthM
  const code = type?.toUpperCase() ?? null

  return (
    <section aria-label="Aircraft" className="mb-4 overflow-hidden rounded-2xl bg-[#0D1424] ring-1 ring-white/10">
      <div
        ref={stage}
        className="relative h-[17rem] w-full overflow-hidden sm:h-[18.5rem]"
        style={{
          backgroundColor: '#0D1527',
          backgroundImage: [
            'radial-gradient(120% 90% at 50% 45%, rgba(70,100,170,0.22), rgba(13,21,39,0) 70%)',
            'linear-gradient(rgba(140,170,230,0.075) 1px, transparent 1px)',
            'linear-gradient(90deg, rgba(140,170,230,0.075) 1px, transparent 1px)',
            'linear-gradient(rgba(140,170,230,0.035) 1px, transparent 1px)',
            'linear-gradient(90deg, rgba(140,170,230,0.035) 1px, transparent 1px)',
          ].join(','),
          backgroundSize: '100% 100%, 64px 64px, 64px 64px, 16px 16px, 16px 16px',
          backgroundPosition: 'center, center, center, center, center',
        }}
      >
        <div className="pointer-events-none absolute left-3 top-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#9DB4E8]/70">
          Top view{code ? ` · ${code}` : ''}
        </div>
        {registration && (
          <div className="absolute right-3 top-2 rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-white/85 ring-1 ring-white/10">{registration}</div>
        )}
        {layout && (
          <div ref={art} className="absolute" style={{ left: layout.cx, top: layout.cy, transform: 'translate(-50%, -50%)' }}>
            <canvas ref={canvas} role="img" aria-label={`Top view of ${profile.title ?? 'the aircraft'}`} className="block" style={{ filter: 'drop-shadow(7px 11px 9px rgba(0,0,0,0.5))' }} />
          </div>
        )}
        {layout && (
          <svg ref={dims} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
            {/* Wingspan, under the aircraft */}
            <g stroke="#8FB0F0" strokeOpacity={0.55} strokeWidth={1} fill="none">
              {(() => {
                const y = layout.cy + layout.h / 2 + 22
                const x0 = layout.cx - layout.w / 2
                const x1 = layout.cx + layout.w / 2
                const xr = layout.cx + layout.w / 2 + 24
                const y0 = layout.cy - layout.h / 2
                const y1 = layout.cy + layout.h / 2
                return (
                  <>
                    <path data-draw pathLength={1} strokeDasharray="1 1" d={`M${x0} ${y - 5}V${y + 5}M${x0} ${y}H${x1}M${x1} ${y - 5}V${y + 5}`} />
                    <path data-draw pathLength={1} strokeDasharray="1 1" d={`M${xr - 5} ${y0}H${xr + 5}M${xr} ${y0}V${y1}M${xr - 5} ${y1}H${xr + 5}`} />
                  </>
                )
              })()}
            </g>
            {(spanM != null || lengthM != null) && (
              <g fill="#BFD1F7" fontSize={10.5} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" letterSpacing="0.06em">
                {spanM != null && (
                  <text data-fade x={layout.cx} y={layout.cy + layout.h / 2 + 22 - 6} textAnchor="middle" style={{ paintOrder: 'stroke' }} stroke="#0D1527" strokeWidth={4}>
                    {isHeli ? 'ROTOR ' : ''}
                    {formatLength(spanM, altitudeUnit)}
                  </text>
                )}
                {lengthM != null && (
                  <text data-fade transform={`translate(${layout.cx + layout.w / 2 + 24 + 13} ${layout.cy}) rotate(90)`} textAnchor="middle" style={{ paintOrder: 'stroke' }} stroke="#0D1527" strokeWidth={4}>
                    {formatLength(lengthM, altitudeUnit)}
                  </text>
                )}
              </g>
            )}
          </svg>
        )}
      </div>

      <div className="px-4 pb-4 pt-3">
        <h3 className="truncate text-lg font-bold leading-tight">{profile.title ?? 'Aircraft type not reported'}</h3>
        <p className="mt-0.5 text-[13px] text-white/55">{facts ? facts.kind : profile.title ? 'No specifications on file for this type.' : 'The transponder did not say what this is; drawn by its class.'}</p>
        {facts && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
            <Fact label="Engines" value={describeEngines(facts.engines)} />
            {facts.spanM != null && <Fact label={isHeli ? 'Rotor diameter' : 'Wingspan'} value={formatLength(facts.spanM, altitudeUnit)} />}
            {facts.lengthM != null && <Fact label="Length" value={formatLength(facts.lengthM, altitudeUnit)} />}
            {facts.seats && <Fact label="Seats" value={facts.seats} />}
            {facts.rangeNm != null && <Fact label="Range" value={formatRange(facts.rangeNm, speedUnit)} />}
            {facts.cruise && <Fact label="Cruise" value={formatCruise(facts.cruise, speedUnit)} />}
            {facts.firstFlight != null && <Fact label="First flight" value={String(facts.firstFlight)} />}
            {registration && <Fact label="Registration" value={registration} />}
          </dl>
        )}
        {!facts && registration && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4">
            <Fact label="Registration" value={registration} />
          </dl>
        )}
      </div>
    </section>
  )
}
