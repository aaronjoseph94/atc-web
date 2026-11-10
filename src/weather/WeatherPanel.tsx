/**
 * Weather and ATIS for the current airport: the latest observation decoded
 * into plain numbers, a wind rose showing how the wind lines up with the
 * runways, and the real ATIS broadcast, which can be read aloud.
 */
import { ExternalLink, Square, Volume2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { icaoCode } from '../api/airportData'
import { getAirport } from '../api/airports'
import { useNow } from '../hooks/useNow'
import type { Atis, Metar } from '../api/types'
import { useAirfield } from '../live/airfield'
import { summariseRunwayUse, type ActiveRunways } from '../live/runwayUse'
import { runwayEnds, type RunwayEndGeometry } from '../map/airportDiagram'
import { RUNWAY_USE_COLOR } from '../map/mapStyle'
import { usePlayhead } from '../playback/playheadStore'
import { CATEGORY_COLOR, useWeather } from '../station/StationBar'
import { PanelFrame, SectionLabel } from '../ui/Panel'
import { EmptyState, OfflineArt, StateAction, WeatherSkeleton } from '../ui/States'
import { ceilingFt, phonetic, readableAtis, runwayWinds, sentenceCase } from './atis'
import { tafLines } from './taf'

const CATEGORY_TEXT = {
  VFR: 'Clear enough to fly by sight',
  MVFR: 'Marginal: lowish cloud or haze',
  IFR: 'Instrument conditions: low cloud or poor visibility',
  LIFR: 'Very low cloud or fog',
} as const

function WindRose({ metar, ends }: { metar: Metar; ends: RunwayEndGeometry[] }) {
  const dir = metar.windDirDeg
  // One line per runway (each has two ends on the same line).
  const lines = [...new Map(ends.map((e) => [Math.round(e.bearing % 180), e])).values()]
  return (
    <svg viewBox="-60 -60 120 120" className="size-36 shrink-0" role="img" aria-label={dir != null ? `Wind from ${dir} degrees at ${metar.windKt} knots` : 'Wind calm or variable'}>
      <circle r="52" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)" />
      {[0, 90, 180, 270].map((a) => (
        <text key={a} x={Math.sin((a * Math.PI) / 180) * 44} y={-Math.cos((a * Math.PI) / 180) * 44 + 3.5} textAnchor="middle" fontSize="9" fontWeight="700" fill="rgba(255,255,255,0.45)">
          {'NESW'[a / 90]}
        </text>
      ))}
      {lines.map((e) => (
        <line key={e.ident} x1="0" y1="-30" x2="0" y2="30" stroke="rgba(255,255,255,0.55)" strokeWidth="5" strokeLinecap="round" transform={`rotate(${e.bearing})`} />
      ))}
      {dir != null && (
        <g transform={`rotate(${dir})`} className="transition-transform duration-700">
          {/* Arrow flies with the wind: tail where it comes from, head toward the centre. */}
          <line x1="0" y1="-50" x2="0" y2="-14" stroke="#FFB800" strokeWidth="3" strokeLinecap="round" />
          <path d="M0 -6 L-7 -20 L7 -20 Z" fill="#FFB800" />
        </g>
      )}
    </svg>
  )
}

/** `↓ Landing 22L 22R · ↑ Departing 22R 31L`: from the traffic, else the ATIS, else the wind's guess. */
function RunwaysInUse({ active }: { active: ActiveRunways }) {
  const arrow = (up: boolean) => (
    <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold leading-none text-white" style={{ background: up ? RUNWAY_USE_COLOR.departures : RUNWAY_USE_COLOR.arrivals }}>
      {up ? '↑' : '↓'}
    </span>
  )
  if (active.basis === 'wind') return <p className="mb-2.5 text-white/70">No landings or departures seen yet. {summariseRunwayUse(active)}.</p>
  return (
    <>
      <p className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold tabular-nums text-white" aria-label={summariseRunwayUse(active) ?? undefined}>
        {active.landing.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            {arrow(false)}Landing {active.landing.join(' ')}
          </span>
        )}
        {active.landing.length > 0 && active.departing.length > 0 && <span className="text-white/35">·</span>}
        {active.departing.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            {arrow(true)}Departing {active.departing.join(' ')}
          </span>
        )}
      </p>
      {active.basis === 'atis' && <p className="-mt-1.5 mb-2.5 text-caption text-atc-muted">As announced on the ATIS; no landings or departures seen yet.</p>}
    </>
  )
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.05] px-3 py-2.5">
      <div className="text-caption font-medium text-white/55">{label}</div>
      <div className="mt-0.5 text-body font-bold tabular-nums">{value}</div>
      {hint && <div className="text-caption2 text-white/50">{hint}</div>}
    </div>
  )
}

/** Read text aloud with the browser's speech synthesizer. */
function useSpeech() {
  const [speaking, setSpeaking] = useState<string | null>(null)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  useEffect(() => () => window.speechSynthesis?.cancel(), [])
  return {
    supported,
    speaking,
    stop: () => {
      window.speechSynthesis.cancel()
      setSpeaking(null)
    },
    speak: (id: string, text: string) => {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 1.05
      u.lang = 'en-US'
      u.onend = () => setSpeaking((cur) => (cur === id ? null : cur))
      u.onerror = () => setSpeaking(null)
      setSpeaking(id)
      window.speechSynthesis.speak(u)
    },
  }
}

/** `docked`: rendered in the desktop side panel instead of as a sheet. */
export function WeatherPanel({ docked = false }: { docked?: boolean }) {
  const open = usePlayhead((s) => s.panel === 'weather') || docked
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const active = useAirfield((s) => s.runways)
  const setPanel = usePlayhead((s) => s.setPanel)
  const query = useWeather(airportIcao)
  const speech = useSpeech()
  const [raw, setRaw] = useState(false)
  const now = useNow()

  const airport = getAirport(airportIcao)
  const ends = useMemo(() => runwayEnds(airportIcao), [airportIcao])
  const metar = query.data?.metar ?? null
  const atis = query.data?.atis ?? []
  const taf = tafLines(query.data?.taf)
  const winds = useMemo(() => runwayWinds(metar, ends), [metar, ends])
  const inUse = summariseRunwayUse(active)

  const close = () => {
    speech.stop()
    setPanel(null)
  }
  const icao = icaoCode(airportIcao) ?? airportIcao
  const ceiling = metar ? ceilingFt(metar) : null
  const ageMin = metar ? Math.max(0, Math.round((now - new Date(metar.observedAt).getTime()) / 60_000)) : null

  const atisCard = (a: Atis) => {
    const id = `${a.kind}-${a.code}`
    const spoken = readableAtis(a.text)
    return (
      <div key={id} className="rounded-2xl bg-white/[0.05] p-3.5">
        <div className="flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-atc-yellow font-display text-[30px] leading-none text-black">{a.code || '?'}</span>
          <div className="min-w-0 flex-1">
            <div className="text-subhead font-semibold">Information {phonetic(a.code)}</div>
            <div className="text-caption text-atc-muted">{a.kind === 'combined' ? 'Arrivals and departures' : a.kind === 'arrival' ? 'Arrivals' : 'Departures'}</div>
          </div>
          {speech.supported && (
            <button
              type="button"
              className="pressable flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-footnote font-semibold text-black hover:bg-white/90"
              onClick={() => (speech.speaking === id ? speech.stop() : speech.speak(id, spoken))}
            >
              {speech.speaking === id ? <Square className="size-3.5 fill-current" /> : <Volume2 className="size-4" />}
              {speech.speaking === id ? 'Stop' : 'Read aloud'}
            </button>
          )}
        </div>
        <p className="mt-3 text-subhead text-white/85">{raw ? a.text : sentenceCase(spoken)}</p>
      </div>
    )
  }

  return (
    <PanelFrame docked={docked} open={open} title={`Weather at ${airport.icao}`} onClose={close}>
      {query.isPending ? (
        <WeatherSkeleton />
      ) : !metar && atis.length === 0 ? (
        <EmptyState
          art={<OfflineArt />}
          title="Weather isn’t available right now"
          actions={
            <StateAction primary busy={query.isFetching} onClick={() => void query.refetch()}>
              {query.isFetching ? 'Trying…' : 'Try again'}
            </StateAction>
          }
        >
          The weather service didn’t answer for {icao}.
        </EmptyState>
      ) : (
        <>
          {metar && (
            <>
              <div className="flex items-center gap-4 rounded-2xl bg-white/[0.05] p-3.5">
                <WindRose metar={metar} ends={ends} />
                <div className="min-w-0 flex-1">
                  {metar.flightCategory && (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-bold text-white" style={{ background: CATEGORY_COLOR[metar.flightCategory] }}>
                      {metar.flightCategory}
                    </span>
                  )}
                  <p className="mt-1.5 text-footnote text-white/80">{metar.flightCategory ? CATEGORY_TEXT[metar.flightCategory] : 'Conditions reported'}</p>
                  <p className="mt-2 text-title2 font-bold tabular-nums">
                    {metar.windKt ? `${metar.windDirDeg != null ? `${String(metar.windDirDeg).padStart(3, '0')}°` : 'Variable'} at ${metar.windKt} kt` : 'Calm'}
                  </p>
                  {metar.gustKt && <p className="text-footnote text-white/70">Gusting {metar.gustKt} kt</p>}
                  <p className="mt-1 text-caption text-atc-muted">Observed {ageMin === 0 ? 'just now' : `${ageMin} min ago`}</p>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 @xl:grid-cols-4">
                <Fact label="Visibility" value={metar.visibilitySm != null ? `${metar.visibilitySm}${metar.visibilityPlus ? '+' : ''} mi` : '—'} hint={metar.weather ?? undefined} />
                <Fact label="Cloud ceiling" value={ceiling != null ? `${ceiling.toLocaleString()} ft` : 'None'} hint={metar.clouds[0] ? metar.clouds.map((c) => c.cover).join(' ') : 'clear'} />
                <Fact label="Temperature" value={metar.tempC != null ? `${Math.round(metar.tempC)}°C` : '—'} hint={metar.tempC != null ? `${Math.round((metar.tempC * 9) / 5 + 32)}°F, dew point ${metar.dewpointC != null ? Math.round(metar.dewpointC) : '—'}°C` : undefined} />
                <Fact label="Altimeter" value={metar.altimeterInHg != null ? `${metar.altimeterInHg.toFixed(2)}` : '—'} hint="inches of mercury" />
              </div>

              {(winds.length > 0 || inUse) && (
                <>
                  <SectionLabel>Runways</SectionLabel>
                  <div className="rounded-2xl bg-white/[0.05] p-3.5 text-footnote">
                    {active && inUse && <RunwaysInUse active={active} />}
                    {winds.length > 0 && (
                      <>
                        <p className="mb-2 text-caption text-atc-muted">Aircraft land and take off into the wind. Best aligned right now:</p>
                        <ul className="grid grid-cols-1 gap-1.5 @xl:grid-cols-2">
                          {winds.slice(0, 4).map((w) => (
                            <li key={w.ident} className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-3 py-2">
                              <span className="rounded-md bg-[#C8102E] px-1.5 py-0.5 text-caption font-bold text-white ring-1 ring-white/70">{w.ident}</span>
                              <span className="tabular-nums text-white/85">
                                {w.headwindKt >= 0 ? `${w.headwindKt} kt headwind` : `${-w.headwindKt} kt tailwind`}
                                {w.crosswindKt > 0 && w.from ? `, ${w.crosswindKt} kt from the ${w.from}` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          <SectionLabel>ATIS broadcast</SectionLabel>
          {atis.length > 0 ? (
            <div className="space-y-2">
              {atis.map(atisCard)}
              <button type="button" className="px-1 text-caption font-medium text-atc-muted underline decoration-white/20 underline-offset-2 transition-colors hover:text-white" onClick={() => setRaw(!raw)}>
                {raw ? 'Show the readable version' : 'Show the original shorthand'}
              </button>
            </div>
          ) : (
            <p className="rounded-2xl bg-white/[0.05] p-3.5 text-footnote text-atc-muted">
              {airport.group === 'US' ? 'No digital ATIS is published for this airport right now.' : 'Digital ATIS text is only published for US airports. The observation above is current.'}
            </p>
          )}

          {metar && (
            <>
              <SectionLabel>Original observation</SectionLabel>
              <p className="break-words rounded-2xl bg-white/[0.05] p-3.5 font-mono text-caption text-white/75">{metar.raw}</p>
            </>
          )}

          {/* The terminal forecast comes with every weather answer but was never shown; one period per line. */}
          {taf.length > 0 && (
            <>
              <SectionLabel>Forecast (TAF)</SectionLabel>
              <div className="break-words rounded-2xl bg-white/[0.05] p-3.5 font-mono text-caption text-white/75">
                {taf.map((line, i) => (
                  <p key={i} className={i ? 'mt-1 pl-3' : ''}>
                    {line}
                  </p>
                ))}
              </div>
            </>
          )}

          <SectionLabel>More about {airport.icao}</SectionLabel>
          <div className="grid grid-cols-1 gap-1.5 @xl:grid-cols-3">
            {[
              ['Live tower radio', 'liveatc.net', `https://www.liveatc.net/search/?icao=${icao}`],
              ['Official airport diagram', 'airnav.com', `https://www.airnav.com/airport/${icao}`],
              ['Aeronautical chart', 'skyvector.com', `https://skyvector.com/airport/${airportIcao}`],
            ].map(([label, host, href]) => (
              <a key={href} href={href} target="_blank" rel="noreferrer" className="pressable-soft flex items-center justify-between gap-2 rounded-2xl bg-white/[0.05] px-3.5 py-3 hover:bg-white/[0.09]">
                <span className="min-w-0">
                  <span className="block truncate text-footnote font-semibold">{label}</span>
                  <span className="block text-caption text-atc-muted">{host}</span>
                </span>
                <ExternalLink className="size-4 shrink-0 text-white/50" />
              </a>
            ))}
          </div>
          <p className="mt-4 px-1 text-caption text-atc-muted">Weather from aviationweather.gov (US National Weather Service); ATIS text via atis.info. For interest only, not for flight planning.</p>
        </>
      )}
    </PanelFrame>
  )
}
