/**
 * Weather and ATIS for the current airport, laid out like an aviation
 * weather card: a summary up top (flight category, temperature, conditions
 * in plain words, how old the report is), the wind and what it means on the
 * runways in use, compact tiles for the rest of the observation, the ATIS
 * broadcast (readable, or read aloud), the forecast as a timeline, and the
 * raw reports for those who want them.
 */
import { ChevronDown, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Eye, Gauge, Moon, Mountain, Square, Sun, Thermometer, Volume2, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { icaoCode } from '../api/airportData'
import { getAirport } from '../api/airports'
import type { Atis, Metar } from '../api/types'
import { useNow } from '../hooks/useNow'
import { BriefingBlock } from '../insights/Briefing'
import { WeatherMeaning } from '../insights/WeatherMeaning'
import { Terms } from '../learn/Terms'
import { useAirfield } from '../live/airfield'
import { runwayEnds } from '../map/airportDiagram'
import { sunElevation, SUNSET_ELEVATION } from '../map/lighting/sun'
import { usePlayhead } from '../playback/playheadStore'
import { useSettings, type AltitudeUnit } from '../settings/settingsStore'
import { CATEGORY_COLOR, useWeather } from '../station/StationBar'
import { Hint } from '../ui/kit'
import { PanelFrame, SectionLabel } from '../ui/Panel'
import { EmptyState, OfflineArt, StateAction, WeatherSkeleton } from '../ui/States'
import { atisForScreen, phonetic, readableAtis } from './atis'
import { agoText, CATEGORY_TEXT, ceilingOf, conditionsLine, coverOktas, coverWord, densityAltitudeFt, formatHeight, formatVisibility, reportsHpa, signed, toF, toHpa } from './decode'
import { RawReport } from './RawReport'
import { TafTimeline } from './TafTimeline'
import { WindCard } from './WindCard'

/** An observation older than this is flagged: METARs come hourly, so one is missing. */
const STALE_MIN = 75
const AMBER = '#FFB340'

/** Read text aloud with the browser's speech synthesizer. */
function useSpeech() {
  const [speaking, setSpeaking] = useState<string | null>(null)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  useEffect(() => () => window.speechSynthesis?.cancel(), [])
  return {
    supported,
    speaking,
    stop: () => {
      window.speechSynthesis?.cancel()
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

/** A picture for the sky: storms, snow, rain, fog, else how cloudy, with the moon at night. */
function skyIcon(m: Metar, night: boolean): LucideIcon {
  const wx = m.weather ?? ''
  if (/TS/.test(wx)) return CloudLightning
  if (/SN|SG|PL|IC|GR|GS/.test(wx)) return CloudSnow
  if (/DZ/.test(wx)) return CloudDrizzle
  if (/RA|SH|UP/.test(wx)) return CloudRain
  if (/FG|BR|HZ|FU|DU|SA/.test(wx)) return CloudFog
  if (ceilingOf(m.clouds) != null) return Cloud
  if (m.clouds.some((c) => c.cover === 'FEW' || c.cover === 'SCT')) return night ? CloudMoon : CloudSun
  return night ? Moon : Sun
}

function SkyGlyph({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden className="ml-auto size-12 shrink-0 text-white/85 @md:size-14" strokeWidth={1.5} />
}

function CategoryChip({ category }: { category: NonNullable<Metar['flightCategory']> }) {
  return (
    <span className="inline-flex h-6 items-center rounded-full px-2.5 text-caption font-bold tracking-[0.02em] text-white shadow-[0_1px_6px_rgb(0_0_0/0.25)]" style={{ background: CATEGORY_COLOR[category] }}>
      {category}
    </span>
  )
}

function Hero({ metar, ageMs, night, heights }: { metar: Metar; ageMs: number; night: boolean; heights: AltitudeUnit }) {
  const cat = metar.flightCategory
  const tint = cat ? CATEGORY_COLOR[cat] : '#7c5cfc'
  const stale = ageMs > STALE_MIN * 60_000
  return (
    <section
      aria-label="Current conditions"
      className="relative overflow-hidden rounded-2xl p-4 ring-1 ring-inset ring-white/[0.08]"
      // A wash of the category colour from the top corner, over the panel's own glass.
      style={{ background: `radial-gradient(130% 110% at 0% 0%, color-mix(in srgb, ${tint} 30%, transparent), transparent 62%), linear-gradient(180deg, rgb(255 255 255 / 0.07), rgb(255 255 255 / 0.03))` }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {cat && <CategoryChip category={cat} />}
          <span className="truncate text-footnote font-medium text-white/70">{cat ? CATEGORY_TEXT[cat] : 'Conditions reported'}</span>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-caption font-medium tabular-nums" style={{ color: stale ? AMBER : 'rgb(255 255 255 / 0.55)' }} title={new Date(metar.observedAt).toLocaleString()}>
          <span aria-hidden className={`size-1.5 rounded-full ${stale ? '' : 'animate-pulse-dot'}`} style={{ background: stale ? AMBER : '#30D158' }} />
          {agoText(ageMs)}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex items-start font-light leading-none tracking-[-0.03em] tabular-nums">
          <span className="text-[3.5rem]">{metar.tempC != null ? signed(metar.tempC) : '—'}</span>
          <span className="mt-1.5 text-title2 font-normal text-white/55">°C</span>
        </div>
        <SkyGlyph icon={skyIcon(metar, night)} />
      </div>
      <p className="mt-2 text-body font-semibold">{conditionsLine(metar, heights)}</p>
      {metar.tempC != null && (
        <p className="mt-0.5 text-footnote tabular-nums text-white/55">
          {signed(toF(metar.tempC))}°F{metar.dewpointC != null ? ` · Dew point ${signed(metar.dewpointC)}°C` : ''}
        </p>
      )}
    </section>
  )
}

function Tile({ icon: Icon, label, children, hint, tone, className = '' }: { icon: LucideIcon; label: string; children: ReactNode; hint?: ReactNode; tone?: 'warn'; className?: string }) {
  return (
    <div className={`ui-card min-w-0 px-3 py-2.5 ${className}`}>
      <div className="flex items-center gap-1.5 text-caption font-medium text-white/55">
        <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-title3 font-semibold tabular-nums">{children}</div>
      {hint && <div className="mt-0.5 text-caption tabular-nums" style={{ color: tone === 'warn' ? AMBER : 'rgb(255 255 255 / 0.5)' }}>{hint}</div>}
    </div>
  )
}

const Unit = ({ children }: { children: ReactNode }) => <span className="ml-1 text-footnote font-medium text-white/50">{children}</span>

/** Sky cover as on a station model: a circle filled by the eighths of sky the layer covers. */
function Okta({ cover }: { cover: string }) {
  const n = coverOktas(cover)
  const a = (n / 8) * 2 * Math.PI
  const [x, y] = [Math.sin(a) * 6, -Math.cos(a) * 6]
  return (
    <svg viewBox="-8 -8 16 16" className="size-4 shrink-0" aria-hidden>
      <circle r="6.25" fill="#121821" stroke="rgba(255,255,255,0.7)" strokeWidth="1.3" />
      {n >= 8 ? <circle r="6" fill="#fff" /> : n > 0 && <path d={`M0 0 L0 -6 A6 6 0 ${n > 4 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`} fill="#fff" />}
    </svg>
  )
}

/** The cloud layers stacked as they sit in the sky, highest at the top, on a thin height line down to the field. */
function CloudStack({ metar, heights }: { metar: Metar; heights: AltitudeUnit }) {
  const ceiling = ceilingOf(metar.clouds)
  const layers = metar.clouds.filter((c) => coverOktas(c.cover) > 0).sort((a, b) => (b.baseFt ?? 0) - (a.baseFt ?? 0))
  return (
    <div className="ui-card row-span-2 flex min-w-0 flex-col px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-caption font-medium text-white/55">
        <Cloud aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
        Ceiling
      </div>
      <div className="mt-1 truncate text-title3 font-semibold tabular-nums">{ceiling != null ? formatHeight(ceiling, heights) : 'None'}</div>
      <ol className="relative mt-2 flex flex-1 flex-col justify-end gap-1.5 pb-3" aria-label="Cloud layers">
        {/* Height line and the ground. */}
        <span aria-hidden className="absolute bottom-1.5 left-[7.5px] top-1 w-px bg-white/15" />
        <span aria-hidden className="absolute bottom-1 left-0 right-0 h-[3px] rounded-full bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0.22)_0_4px,transparent_4px_7px)]" />
        {layers.length === 0 ? (
          <li className="relative flex items-center gap-2 text-caption text-white/60">
            <Okta cover="SKC" />
            Sky clear
          </li>
        ) : (
          layers.slice(0, 4).map((c, i) => {
            const isCeiling = c.baseFt === ceiling && /^(BKN|OVC|OVX)/.test(c.cover)
            return (
              <li key={i} className={`relative flex items-center gap-2 text-caption ${isCeiling ? 'text-white' : 'text-white/60'}`}>
                <Okta cover={c.cover} />
                <span className={`min-w-0 flex-1 truncate ${isCeiling ? 'font-semibold' : ''}`}>{coverWord(c.cover)}</span>
                <span className="shrink-0 tabular-nums">{c.baseFt != null ? formatHeight(c.baseFt, heights) : '—'}</span>
              </li>
            )
          })
        )}
      </ol>
    </div>
  )
}

function Tiles({ metar, elevationFt, heights }: { metar: Metar; elevationFt: number; heights: AltitudeUnit }) {
  const spread = metar.tempC != null && metar.dewpointC != null ? Math.round(metar.tempC - metar.dewpointC) : null
  const da = densityAltitudeFt(elevationFt, metar.tempC, metar.altimeterInHg)
  const hpa = reportsHpa(metar.raw)
  const vis = metar.visibilitySm
  const visHint = vis == null ? undefined : metar.visibilityPlus ? 'Unrestricted' : vis < 3 ? 'Poor' : vis <= 5 ? 'Reduced' : 'Good'
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <Tile icon={Eye} label="Visibility" hint={visHint} tone={vis != null && vis < 3 ? 'warn' : undefined}>
        {formatVisibility(vis, metar.visibilityPlus, heights)}
      </Tile>
      <CloudStack metar={metar} heights={heights} />
      <Tile
        icon={Thermometer}
        label="Temp / dew point"
        hint={spread != null ? (spread <= 3 ? `Spread ${spread}°: fog likely` : `Spread ${spread}°`) : undefined}
        tone={spread != null && spread <= 3 ? 'warn' : undefined}
      >
        {metar.tempC != null ? `${signed(metar.tempC)}°` : '—'}
        <span className="font-normal text-white/35"> / </span>
        {metar.dewpointC != null ? `${signed(metar.dewpointC)}°` : '—'}
      </Tile>
      <Tile icon={Gauge} label="Altimeter" hint={metar.altimeterInHg != null ? (hpa ? `${metar.altimeterInHg.toFixed(2)} inHg` : `${toHpa(metar.altimeterInHg)} hPa`) : undefined}>
        {metar.altimeterInHg == null ? '—' : hpa ? toHpa(metar.altimeterInHg) : metar.altimeterInHg.toFixed(2)}
        {metar.altimeterInHg != null && <Unit>{hpa ? 'hPa' : 'inHg'}</Unit>}
      </Tile>
      {da != null && (
        <Tile icon={Mountain} label="Density altitude" hint={`Field ${formatHeight(elevationFt, heights)}`} tone={da - elevationFt > 2000 ? 'warn' : undefined}>
          {formatHeight(da, heights)}
        </Tile>
      )}
    </div>
  )
}

function AtisCard({ atis, speech, now }: { atis: Atis; speech: ReturnType<typeof useSpeech>; now: number }) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState(false)
  const id = `${atis.kind}-${atis.code}`
  const speaking = speech.speaking === id
  const text = raw ? atis.text : atisForScreen(atis.text)
  const updated = atis.updatedAt ? Date.parse(atis.updatedAt) : NaN
  return (
    <div className="ui-card">
      <div className="flex items-center gap-3 p-3.5 pb-2.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-atc-yellow font-display text-[28px] leading-none text-black shadow-[inset_0_-2px_0_rgb(0_0_0/0.12)]" aria-hidden>
          {atis.code || '?'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-subhead font-semibold">Information {phonetic(atis.code)}</div>
          <div className="truncate text-caption text-atc-muted">
            {atis.kind === 'combined' ? 'Arrivals and departures' : atis.kind === 'arrival' ? 'Arrivals' : 'Departures'}
            {Number.isFinite(updated) ? ` · ${agoText(now - updated)}` : ''}
          </div>
        </div>
        {speech.supported && (
          <button
            type="button"
            aria-label={speaking ? 'Stop reading' : `Read information ${phonetic(atis.code)} aloud`}
            className={`pressable flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-footnote font-semibold @sm:px-3.5 ${speaking ? 'bg-atc-card text-white' : 'bg-white text-black hover:bg-white/90'}`}
            onClick={() => (speaking ? speech.stop() : speech.speak(id, readableAtis(atis.text)))}
          >
            {speaking ? <Square className="size-3.5 fill-current" /> : <Volume2 className="size-4" />}
            <span className="hidden @sm:inline">{speaking ? 'Stop' : 'Listen'}</span>
          </button>
        )}
      </div>
      <div className="px-3.5 pb-1.5">
        <p className={`text-subhead text-white/85 ${raw ? 'break-words font-mono text-footnote' : ''} ${open ? '' : 'line-clamp-3 [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]'}`}>{raw ? text : <Terms text={text} />}</p>
      </div>
      <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
        <button type="button" aria-expanded={open} className="pressable flex min-h-10 items-center gap-1 rounded-full px-2 text-footnote font-semibold text-[#C9BCFF] hover:text-white" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Full broadcast'}
          <ChevronDown aria-hidden className={`size-4 transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] ${open ? 'rotate-180' : ''}`} strokeWidth={2.5} />
        </button>
        {open && (
          <button type="button" className="pressable min-h-10 rounded-full px-2 text-caption font-medium text-atc-muted hover:text-white" onClick={() => setRaw(!raw)}>
            {raw ? 'Readable version' : 'Original shorthand'}
          </button>
        )}
      </div>
    </div>
  )
}

/** `docked`: rendered in the desktop side panel instead of as a sheet. */
export function WeatherPanel({ docked = false }: { docked?: boolean }) {
  const open = usePlayhead((s) => s.panel === 'weather') || docked
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const active = useAirfield((s) => s.runways)
  const setPanel = usePlayhead((s) => s.setPanel)
  const heights = useSettings((s) => s.altitudeUnit)
  const query = useWeather(airportIcao)
  const speech = useSpeech()
  const now = useNow()

  const airport = getAirport(airportIcao)
  const ends = useMemo(() => runwayEnds(airportIcao), [airportIcao])
  const metar = query.data?.metar ?? null
  const atis = query.data?.atis ?? []
  const taf = query.data?.taf?.trim() || null
  const night = sunElevation(now, airport.center[1], airport.center[0]) < SUNSET_ELEVATION

  const close = () => {
    speech.stop()
    setPanel(null)
  }
  const icao = icaoCode(airportIcao) ?? airportIcao

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
          {query.isError && (
            <p role="status" className="mb-2 rounded-xl bg-[#FFB340]/10 px-3 py-2 text-caption text-[#FFC266] ring-1 ring-inset ring-[#FFB340]/20">
              Couldn’t refresh just now; showing the last report.
            </p>
          )}
          {/* The side panel has the briefing on its Now tab. */}
          {!docked && <BriefingBlock />}
          {metar ? (
            <>
              <Hero metar={metar} ageMs={now - Date.parse(metar.observedAt)} night={night} heights={heights} />
              <WeatherMeaning airport={airport.icao} metar={metar} taf={taf} atis={atis} active={active} ends={ends} />
              <div className="mt-2">
                <WindCard metar={metar} ends={ends} active={active} />
              </div>
              <Tiles metar={metar} elevationFt={airport.elevationFt} heights={heights} />
            </>
          ) : (
            <EmptyState compact title="No current observation">
              {icao} hasn’t reported its weather recently. The ATIS below is the latest word.
            </EmptyState>
          )}

          <SectionLabel>ATIS</SectionLabel>
          {atis.length > 0 ? (
            <div className="space-y-2">
              {atis.map((a) => (
                <AtisCard key={`${a.kind}-${a.code}`} atis={a} speech={speech} now={now} />
              ))}
            </div>
          ) : (
            <Hint>{airport.group === 'US' ? 'No digital ATIS right now.' : 'Digital ATIS: US airports only.'}</Hint>
          )}

          {taf && (
            <>
              <SectionLabel>Forecast</SectionLabel>
              <TafTimeline raw={taf} now={now} fetchedAt={query.data?.fetchedAt} />
            </>
          )}

          {metar && (
            <>
              <SectionLabel>Observation</SectionLabel>
              <RawReport label="Raw METAR" text={metar.raw} />
            </>
          )}

          <p className="mt-4 px-1 text-caption text-atc-muted">Not for flight planning.</p>
        </>
      )}
    </PanelFrame>
  )
}
