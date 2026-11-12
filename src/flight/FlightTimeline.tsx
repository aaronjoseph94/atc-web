/**
 * The flight's life as the app has watched it, for the full flight view: a
 * headline (lands in 3:24, airborne for 4:12, landed 2 min ago), a small
 * speed and altitude chart you can scrub, and the phases with their times.
 *
 * Phases come from `timeline.ts`, worked out from the positions recorded for
 * this aircraft (live) or from the replayed track up to the playhead. Phases
 * we didn't see are greyed rather than given made-up times.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { icaoCode } from '../api/airportData'
import { getAirport } from '../api/airports'
import type { FlightInfo, RouteAirport, TrackSample } from '../api/types'
import { liveRecorder } from '../live/session'
import { runwayEnds } from '../map/airportDiagram'
import { sampleOnGround, trackKeyFor } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'
import { formatAltitude, formatSpeed, useSettings, type AltitudeUnit, type SpeedUnit } from '../settings/settingsStore'
import { Badge } from '../ui/kit'
import { SectionLabel } from '../ui/Panel'
import { arrivalEstimate, buildTimeline, formatCountdown, formatDuration, monotonePath, stepLabel, valueAt, type FlightRole, type Step, type TrackPoint } from './timeline'
import type { FlightView } from './useFlight'

const ALT_COLOR = '#7C5CFC'
const ALT_FILL = '#5B3DF5'
const SPEED_COLOR = '#F5B93D'

const ROLE_LABEL: Record<FlightRole, string> = {
  departure: 'Departure',
  arrival: 'Arrival',
  both: 'Pattern',
  overflight: 'Passing',
  ground: 'On the ground',
}

const fromSample = (t: number, s: TrackSample): TrackPoint => ({
  t,
  lat: s.lat,
  lon: s.lon,
  heading: s.heading,
  altitudeFt: s.altitudeFt ?? null,
  speedKt: s.speedKt ?? null,
  onGround: sampleOnGround(s),
})

/** Wall-clock time, refreshed every half second while `active` (live countdowns). */
function useWallClock(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

/** Reduced motion from the app setting or the system. */
function useReducedMotion(): boolean {
  const setting = useSettings((s) => s.reduceMotion)
  const [system] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  return setting || system
}

export function FlightTimeline({ flight, info }: { flight: FlightView; info: FlightInfo | undefined }) {
  const mode = usePlayhead((s) => s.mode)
  const clip = usePlayhead((s) => s.clip)
  const tMs = usePlayhead((s) => s.tMs)
  const setTMs = usePlayhead((s) => s.setTMs)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const altitudeUnit = useSettings((s) => s.altitudeUnit)
  const speedUnit = useSettings((s) => s.speedUnit)
  const reduced = useReducedMotion()

  const live = mode === 'live'
  const playing = !live && clip ? clip : null
  const airport = getAirport(airportIcao)
  const ends = useMemo(() => runwayEnds(airportIcao), [airportIcao])
  const id = flight.icao24

  // The whole track: the replayed one, or everything recorded live. A few
  // hundred reports at most, so it is simply rebuilt on each render.
  const key = playing ? trackKeyFor(playing, id) : undefined
  const clipTrack = playing && key ? playing.tracks[key] : null
  const full: TrackPoint[] = clipTrack ? clipTrack.map((s) => fromSample(s.tMs, s)) : live ? liveRecorder.track(id).map((s) => fromSample(s.t, s)) : []

  // "Now" on the track's clock, and how much of the track has happened by then.
  const wallNow = useWallClock(live)
  const now = live ? wallNow : tMs
  let cut = full.length
  if (!live) while (cut > 0 && full[cut - 1].t > now) cut--

  // The route says whether this airport is where it is going or where it came from.
  const icao4 = icaoCode(airport.icao)
  const isHere = (a: RouteAirport | null | undefined) => !!a && (a.iata === airport.icao || (!!icao4 && a.icao === icao4))
  const destHere = isHere(info?.destination)
  const roleHint = destHere ? 'arrival' : isHere(info?.origin) ? 'departure' : null

  // Tower-log events, moved onto the track's clock (rewinds count from the clip start).
  const shift = playing?.kind === 'rewind' ? (playing.startedAt ?? 0) : 0
  const events = flight.events.map((e) => ({ kind: e.kind, at: e.at - shift, runway: e.runway }))

  const timeline = buildTimeline(full.slice(0, cut), { ends, elevationFt: airport.elevationFt, roleHint, events })

  // Observed track plus where the aircraft is drawn right now, for the chart's end and the ETA.
  const d = flight.detail
  const observed = full.slice(0, cut)
  const lastT = observed[observed.length - 1]?.t ?? -Infinity
  if (d && now > lastT + 500) observed.push({ t: now, lat: d.lat, lon: d.lon, heading: d.headingKnown === false ? null : d.heading, altitudeFt: d.altitudeFt, speedKt: d.speedKt, onGround: d.onGround })

  // Times: wall clock for real traffic, clip time for a scripted scene.
  const base = live ? 0 : playing?.kind === 'rewind' ? (playing.startedAt ?? null) : null
  const clock = (t: number, seconds = false) => {
    if (base == null) {
      const s = Math.max(0, Math.round(t / 1000))
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    }
    return new Date(base + t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) })
  }

  // Arrival estimate: only for traffic coming here, still in the air.
  const airborne = !!d && !d.onGround
  const destElsewhere = !!info?.destination && !destHere
  const etaWanted = airborne && timeline.role === 'arrival' && timeline.touchdown == null && !destElsewhere && (destHere || !info?.destination)
  const target = (timeline.finalRunway && ends.find((e) => e.ident === timeline.finalRunway)?.threshold) || airport.center
  const estimate = etaWanted ? arrivalEstimate(observed, target) : null
  // Close in but not lined up (circling, or climbing away after a go-around)
  // there is a circuit still to fly, so a straight-line time would be wrong.
  const eta = estimate && timeline.current !== 'goAround' && (timeline.finalRunway != null || estimate.distanceNm > 4) ? estimate : null

  const headline = headlineFor({ timeline, now, eta, clock, airportCode: airport.icao, first: full[0]?.t ?? null, moving: !!d && (d.speedKt ?? 0) >= 2 })

  const markers = [
    timeline.wheelsUp != null ? { t: timeline.wheelsUp, label: 'Wheels up' } : null,
    timeline.touchdown != null ? { t: timeline.touchdown, label: 'Touchdown' } : null,
    ...timeline.steps.filter((s) => s.key === 'goAround' && s.at != null).map((s) => ({ t: s.at!, label: 'Go-around' })),
  ].filter((m): m is { t: number; label: string } => !!m)

  return (
    <section aria-label="Flight timeline" className="mt-5 animate-rise">
      <SectionLabel>Timeline</SectionLabel>
      <div className="ui-card overflow-hidden">
      {/* Headline */}
      <div className="flex items-start justify-between gap-3 bg-gradient-to-br from-atc-card/25 via-atc-card/5 to-transparent px-4 pb-3 pt-3.5">
        <div className="min-w-0">
          <div className="text-caption font-semibold text-white/60">{headline.label}</div>
          <div className="mt-0.5 font-sans text-title1 font-bold tabular-nums text-white">{headline.value}</div>
          {headline.sub && <div className="mt-0.5 truncate text-caption text-white/55">{headline.sub}</div>}
        </div>
        <Badge tone="purple" className="mt-0.5">{ROLE_LABEL[timeline.role]}</Badge>
      </div>

      <TrackChart
        points={live ? observed : full}
        cursorT={live ? (observed[observed.length - 1]?.t ?? now) : now}
        live={live}
        elevationFt={airport.elevationFt}
        markers={markers}
        clock={clock}
        altitudeUnit={altitudeUnit}
        speedUnit={speedUnit}
        reduced={reduced}
        onSeek={playing ? (t) => setTMs(Math.max(0, Math.min(playing.durationMs, t))) : undefined}
      />

      <Steps steps={timeline.steps} role={timeline.role} clock={clock} altitudeUnit={altitudeUnit} reduced={reduced} eta={eta ? now + eta.remainingMs : null} />

      <p className="px-4 pb-3 pt-1 text-caption2 text-white/50">
        {full.length
          ? `Worked out from ${live ? `${full.length} position reports since ${clock(full[0].t)}` : 'the replayed track'}. ~ marks a time estimated between two reports.`
          : 'Waiting for position reports.'}
      </p>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

type Headline = { label: string; value: string; sub: string | null }

function headlineFor({
  timeline,
  now,
  eta,
  clock,
  airportCode,
  first,
  moving,
}: {
  timeline: ReturnType<typeof buildTimeline>
  now: number
  eta: ReturnType<typeof arrivalEstimate>
  clock: (t: number) => string
  airportCode: string
  first: number | null
  moving: boolean
}): Headline {
  const step = (k: Step['key']) => timeline.steps.find((s) => s.key === k)
  const rwy = (s: Step | undefined) => (s?.runway ? ` · runway ${s.runway}` : '')
  if (eta) {
    const nm = eta.distanceNm < 10 ? eta.distanceNm.toFixed(1) : Math.round(eta.distanceNm).toString()
    return {
      label: `Lands at ${airportCode} in`,
      value: eta.remainingMs < 20_000 ? 'Landing now' : formatCountdown(eta.remainingMs),
      sub: `about ${clock(now + eta.remainingMs)} · ${nm} nm out at ${Math.round(eta.groundspeedKt)} kt`,
    }
  }
  if (timeline.touchdown != null) {
    const td = step('touchdown')
    return { label: 'Landed', value: `${formatDuration(now - timeline.touchdown)} ago`, sub: `Touchdown ${clock(timeline.touchdown)}${rwy(td)}` }
  }
  if (timeline.wheelsUp != null) {
    const up = step('airborne')
    return { label: 'Airborne for', value: formatCountdown(now - timeline.wheelsUp), sub: `Wheels up ${clock(timeline.wheelsUp)}${rwy(up)}` }
  }
  const current = timeline.steps.find((s) => s.state === 'current')
  if (current?.at != null) {
    return {
      label: 'Now',
      value: stepLabel(current, timeline.role),
      sub: `${current.inProgress ? 'Under way when first seen at' : 'Since'} ${clock(current.at)} · ${formatDuration(now - current.at)}`,
    }
  }
  return {
    label: 'Now',
    value: moving ? 'Moving' : 'Standing still',
    sub: first != null ? `Watching since ${clock(first)}; no phase change seen yet` : null,
  }
}

// ---------------------------------------------------------------------------
// Phase list
// ---------------------------------------------------------------------------

function Steps({
  steps,
  role,
  clock,
  altitudeUnit,
  reduced,
  eta,
}: {
  steps: Step[]
  role: FlightRole
  clock: (t: number) => string
  altitudeUnit: AltitudeUnit
  reduced: boolean
  /** Estimated touchdown time, for the upcoming touchdown row. */
  eta: number | null
}) {
  if (!steps.length) return null
  // Phases that happened before we started watching read as one quiet line.
  const lead = steps.findIndex((s) => s.state !== 'missed')
  const before = lead > 0 ? steps.slice(0, lead) : []
  const rest = lead > 0 ? steps.slice(lead) : steps
  type Row = { kind: 'before'; steps: Step[] } | { kind: 'step'; step: Step }
  const nextOf = (r: Row | undefined) => (r?.kind === 'step' ? r.step.state : null)
  const rows: Row[] = [...(before.length ? [{ kind: 'before' as const, steps: before }] : []), ...rest.map((step) => ({ kind: 'step' as const, step }))]

  return (
    <ol className="px-4 pb-1 pt-1" aria-label="Phases">
      {rows.map((row, i) => {
        const lastRow = i === rows.length - 1
        const style = reduced ? undefined : { animationDelay: `${80 + i * 35}ms` }
        if (row.kind === 'before') {
          const label = row.steps.length === 1 ? stepLabel(row.steps[0], role) : `${stepLabel(row.steps[0], role)} to ${stepLabel(row.steps[row.steps.length - 1], role).toLowerCase()}`
          return (
            <li key="before" className="relative flex animate-rise gap-3 pb-1" style={style}>
              <Rail state="missed" next={nextOf(rows[i + 1])} last={lastRow} />
              <div className="flex min-h-[30px] min-w-0 flex-1 items-center justify-between gap-3">
                <span className="truncate text-footnote text-white/50">{label}</span>
                <span className="shrink-0 text-caption2 text-white/50">before we saw it</span>
              </div>
            </li>
          )
        }
        const s = row.step
        const nextState = nextOf(rows[i + 1])
        const seen = s.at != null
        const detail = [
          s.runway ? `Runway ${s.runway}` : null,
          s.key === 'level' && s.altitudeFt != null ? `at ${formatAltitude(s.altitudeFt, altitudeUnit)}` : null,
          s.until != null && s.at != null && (s.key === 'takeoffRoll' || s.key === 'rollout') ? formatDuration(s.until - s.at) : null,
          s.inProgress ? 'under way when first seen' : null,
          s.state === 'missed' ? 'not seen' : null,
        ]
          .filter(Boolean)
          .join(' · ')
        const est = s.key === 'touchdown' && s.state === 'upcoming' && eta != null ? eta : null
        return (
          <li key={s.key} className="relative flex animate-rise gap-3" style={style} aria-current={s.state === 'current' ? 'step' : undefined}>
            <Rail state={s.state} next={nextState} last={lastRow} />
            <div className={`flex min-h-[34px] min-w-0 flex-1 items-start justify-between gap-3 ${lastRow ? '' : 'pb-1.5'}`}>
              <div className="min-w-0 pt-[3px]">
                <div className={`truncate text-subhead ${s.state === 'current' ? 'font-semibold text-white' : seen ? 'font-medium text-white/90' : 'text-white/40'}`}>{stepLabel(s, role)}</div>
                {detail && <div className={`truncate text-caption2 ${seen ? 'text-white/55' : 'text-white/40'}`}>{detail}</div>}
              </div>
              <div className="shrink-0 pt-[5px] text-right">
                {seen ? (
                  <time className={`text-footnote tabular-nums ${s.state === 'current' ? 'font-semibold text-[#C4B5FF]' : 'text-white/65'}`}>
                    {s.approx ? '~' : ''}
                    {clock(s.at!)}
                  </time>
                ) : est != null ? (
                  <span className="text-footnote tabular-nums text-white/55">est. {clock(est)}</span>
                ) : null}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** The dot and the line down to the next row. */
function Rail({ state, next, last }: { state: Step['state']; next: Step['state'] | null; last: boolean }) {
  const solid = (state === 'done' || state === 'current') && (next === 'done' || next === 'current')
  return (
    <div aria-hidden className="relative w-[15px] shrink-0">
      {!last && (
        <span
          className={`absolute bottom-[-3px] left-[7px] top-[19px] w-0 border-l-2 ${solid ? 'border-atc-purple/70' : state === 'upcoming' || next === 'upcoming' ? 'border-dashed border-white/15' : 'border-white/12'}`}
        />
      )}
      <span className="absolute left-0 top-[6px] grid size-[15px] place-items-center">
        {state === 'current' ? (
          <>
            <span className="absolute inset-[-3px] animate-pulse-dot rounded-full bg-atc-purple/35" />
            <span className="relative size-[13px] rounded-full bg-atc-purple ring-[3px] ring-[#C4B5FF]/40" />
          </>
        ) : state === 'done' ? (
          <span className="size-[9px] rounded-full bg-atc-purple" />
        ) : state === 'missed' ? (
          <span className="size-[9px] rounded-full border-[1.5px] border-white/25" />
        ) : (
          <span className="size-[9px] rounded-full border-[1.5px] border-dashed border-white/25" />
        )}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Speed and altitude chart
// ---------------------------------------------------------------------------

const CHART_H = 96
const PAD_TOP = 10
const PAD_BOTTOM = 6

function TrackChart({
  points,
  cursorT,
  live,
  elevationFt,
  markers,
  clock,
  altitudeUnit,
  speedUnit,
  reduced,
  onSeek,
}: {
  points: TrackPoint[]
  /** The moment shown as "now": the latest report live, the playhead in a replay. */
  cursorT: number
  live: boolean
  elevationFt: number
  markers: { t: number; label: string }[]
  clock: (t: number, seconds?: boolean) => string
  altitudeUnit: AltitudeUnit
  speedUnit: SpeedUnit
  reduced: boolean
  /** Replays only: jump the playhead to a moment on the chart. */
  onSeek?: (t: number) => void
}) {
  const uid = useId().replace(/:/g, '')
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [scrub, setScrub] = useState<number | null>(null)
  const dragging = useRef(false)
  const [pressed, setPressed] = useState(false)
  const [drawn, setDrawn] = useState(reduced)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  // Draw the lines in once, after the first paint.
  useEffect(() => {
    if (drawn || width === 0) return
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [drawn, width])

  const t0 = points[0]?.t ?? 0
  const t1 = points[points.length - 1]?.t ?? 0
  const span = t1 - t0
  const enough = points.length >= 2 && span >= 5_000

  const altOf = (p: TrackPoint) => (p.onGround ? elevationFt : p.altitudeFt)
  const geom = (() => {
    if (!enough || width === 0) return null
    const W = width
    const x = (t: number) => ((t - t0) / span) * W
    // Thin to about one point every two pixels so long live sessions stay light.
    const step = Math.max(1, Math.floor(points.length / (W / 2)))
    const pts = points.filter((_, i) => i % step === 0 || i === points.length - 1)
    const alts = pts.map(altOf).filter((v): v is number => v != null)
    const spds = pts.map((p) => p.speedKt).filter((v): v is number => v != null)
    const aLo = Math.min(elevationFt, ...alts)
    const aHi = Math.max(aLo + 1000, ...alts) * 1.06
    const sHi = Math.max(80, ...spds) * 1.12
    const yA = (v: number) => PAD_TOP + (1 - (v - aLo) / (aHi - aLo)) * (CHART_H - PAD_TOP - PAD_BOTTOM)
    const yS = (v: number) => PAD_TOP + (1 - v / sHi) * (CHART_H - PAD_TOP - PAD_BOTTOM)
    const segments = (pick: (p: TrackPoint) => number | null, y: (v: number) => number) => {
      const out: [number, number][][] = [[]]
      for (const p of pts) {
        const v = pick(p)
        if (v == null) {
          if (out[out.length - 1].length) out.push([])
          continue
        }
        out[out.length - 1].push([x(p.t), y(v)])
      }
      return out.filter((s) => s.length > 1)
    }
    const altSegs = segments(altOf, yA)
    const spdSegs = segments((p) => p.speedKt, yS)
    const base = CHART_H - PAD_BOTTOM
    return {
      x,
      yA,
      yS,
      alt: altSegs.map(monotonePath).join(' '),
      area: altSegs.map((s) => `${monotonePath(s)} L${s[s.length - 1][0].toFixed(1)} ${base} L${s[0][0].toFixed(1)} ${base} Z`).join(' '),
      speed: spdSegs.map(monotonePath).join(' '),
    }
  })()

  if (!enough) {
    return (
      <div className="mx-4 mb-2 grid h-[96px] place-items-center rounded-xl bg-white/[0.03] text-caption text-white/50" ref={wrap}>
        Collecting speed and altitude…
      </div>
    )
  }

  const shownT = scrub ?? cursorT
  const nearest = points.reduce((best, p) => (Math.abs(p.t - shownT) < Math.abs(best.t - shownT) ? p : best), points[0])
  const altVal = nearest.onGround ? null : valueAt(points, shownT, (p) => p.altitudeFt)
  const spdVal = valueAt(points, shownT, (p) => p.speedKt)
  const altY = valueAt(points, shownT, altOf)

  const toT = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect()
    const u = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    return t0 + u * span
  }
  const down = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    setPressed(true)
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setScrub(toT(e.clientX))
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || dragging.current) setScrub(toT(e.clientX))
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current && onSeek) onSeek(toT(e.clientX))
    dragging.current = false
    setPressed(false)
    if (e.pointerType !== 'mouse') setScrub(null)
  }
  const cancel = () => {
    dragging.current = false
    setPressed(false)
    setScrub(null)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const from = scrub ?? cursorT
      setScrub(Math.min(t1, Math.max(t0, from + (e.key === 'ArrowLeft' ? -1 : 1) * span * 0.04)))
    } else if (e.key === 'Enter' && scrub != null && onSeek) {
      onSeek(scrub)
      setScrub(null)
    } else if (e.key === 'Escape') setScrub(null)
  }

  const g = geom
  const cx = g ? g.x(Math.min(t1, Math.max(t0, cursorT))) : 0
  const sx = g && scrub != null ? g.x(scrub) : null
  const W = width
  const timeLabel = scrub != null ? clock(scrub, true) : live ? 'Now' : clock(cursorT, true)
  const draw = (delay: number) => (reduced ? undefined : { strokeDasharray: 1, strokeDashoffset: drawn ? 0 : 1, transition: `stroke-dashoffset 1100ms var(--ease-out) ${delay}ms` })

  return (
    <div className="px-4 pb-2">
      {/* Legend doubles as the readout for the moment under the cursor. */}
      <div className="mb-1.5 flex items-center gap-4 text-caption tabular-nums">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: ALT_COLOR }} />
          <span className="text-white/50">Altitude</span>
          <span className="font-semibold text-white">{nearest.onGround ? 'Ground' : formatAltitude(altVal == null ? null : Math.round(altVal / 25) * 25, altitudeUnit)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: SPEED_COLOR }} />
          <span className="text-white/50">Speed</span>
          <span className="font-semibold text-white">{formatSpeed(spdVal == null ? null : Math.round(spdVal), speedUnit)}</span>
        </span>
        <span className={`ml-auto shrink-0 ${scrub != null ? 'text-[#C4B5FF]' : 'text-white/45'}`}>{timeLabel}</span>
      </div>

      <div
        ref={wrap}
        data-no-drag
        tabIndex={0}
        role="group"
        aria-label={`Speed and altitude since ${clock(t0)}. Use the arrow keys to look back${onSeek ? ', Enter to jump the replay there' : ''}.`}
        className="relative h-[96px] cursor-crosshair touch-pan-y select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-atc-purple/70"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onPointerLeave={(e) => e.pointerType === 'mouse' && !dragging.current && setScrub(null)}
        onKeyDown={key}
        onBlur={() => setScrub(null)}
      >
        {g && (
          <svg width={W} height={CHART_H} className="absolute inset-0 overflow-visible" aria-hidden>
            <defs>
              <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={ALT_FILL} stopOpacity="0.42" />
                <stop offset="1" stopColor={ALT_FILL} stopOpacity="0" />
              </linearGradient>
              <clipPath id={`${uid}-past`}>
                <rect x={-4} y={-4} width={cx + 4} height={CHART_H + 8} />
              </clipPath>
              <clipPath id={`${uid}-future`}>
                <rect x={cx} y={-4} width={Math.max(0, W - cx + 4)} height={CHART_H + 8} />
              </clipPath>
            </defs>

            {/* Quiet guides: the field and half height. */}
            <line x1={0} x2={W} y1={CHART_H - PAD_BOTTOM + 0.5} y2={CHART_H - PAD_BOTTOM + 0.5} stroke="white" strokeOpacity={0.12} />
            <line x1={0} x2={W} y1={(CHART_H + PAD_TOP - PAD_BOTTOM) / 2} y2={(CHART_H + PAD_TOP - PAD_BOTTOM) / 2} stroke="white" strokeOpacity={0.05} strokeDasharray="2 4" />

            {markers.map((m) => {
              const mx = g.x(m.t)
              if (mx < 0 || mx > W) return null
              return (
                <g key={`${m.label}-${m.t}`}>
                  <line x1={mx} x2={mx} y1={PAD_TOP - 2} y2={CHART_H - PAD_BOTTOM} stroke="white" strokeOpacity={0.22} strokeDasharray="2 3" />
                  <text x={mx + (mx > 64 ? -4 : 4)} y={PAD_TOP + 2} textAnchor={mx > 64 ? 'end' : 'start'} className="fill-white/45 text-[9px] font-semibold">
                    {m.label}
                  </text>
                </g>
              )
            })}

            {(['past', 'future'] as const).map((part) => (
              <g key={part} clipPath={`url(#${uid}-${part})`} opacity={part === 'future' ? 0.3 : 1}>
                <path d={g.area} fill={`url(#${uid}-fill)`} style={reduced ? undefined : { opacity: drawn ? 1 : 0, transition: 'opacity 900ms var(--ease-out) 250ms' }} />
                <path d={g.alt} fill="none" stroke={ALT_COLOR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} style={draw(0)} />
                <path d={g.speed} fill="none" stroke={SPEED_COLOR} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" pathLength={1} style={draw(120)} />
              </g>
            ))}

            {/* Where it is now (live) or at the playhead (replay). */}
            {!live && <line x1={cx} x2={cx} y1={PAD_TOP - 4} y2={CHART_H - PAD_BOTTOM} stroke="white" strokeOpacity={0.35} />}
            {scrub == null && <NowDots x={cx} altY={altY != null ? g.yA(altY) : null} spdY={spdVal != null ? g.yS(spdVal) : null} pulse={live && !reduced} />}

            {sx != null && (
              <g>
                <line x1={sx} x2={sx} y1={PAD_TOP - 4} y2={CHART_H - PAD_BOTTOM} stroke="#C4B5FF" strokeOpacity={0.8} />
                {altY != null && <circle cx={sx} cy={g.yA(altY)} r={4} fill="#15181F" stroke={ALT_COLOR} strokeWidth={2} />}
                {spdVal != null && <circle cx={sx} cy={g.yS(spdVal)} r={4} fill="#15181F" stroke={SPEED_COLOR} strokeWidth={2} />}
              </g>
            )}
          </svg>
        )}
      </div>

      <div className="mt-1 flex justify-between text-caption2 tabular-nums text-white/50">
        <span>{clock(t0)}</span>
        {onSeek && <span className="text-white/45">{scrub == null ? 'Drag to look back · tap to jump' : pressed ? 'Release to jump here' : 'Click to jump here'}</span>}
        <span>{live ? 'now' : clock(t1)}</span>
      </div>
    </div>
  )
}

function NowDots({ x, altY, spdY, pulse }: { x: number; altY: number | null; spdY: number | null; pulse: boolean }) {
  return (
    <g>
      {altY != null && (
        <>
          {pulse && <circle cx={x} cy={altY} r={7} fill={ALT_COLOR} opacity={0.35} className="animate-pulse-dot" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />}
          <circle cx={x} cy={altY} r={3.75} fill={ALT_COLOR} stroke="#15181F" strokeWidth={1.5} />
        </>
      )}
      {spdY != null && <circle cx={x} cy={spdY} r={3.25} fill={SPEED_COLOR} stroke="#15181F" strokeWidth={1.5} />}
    </g>
  )
}
