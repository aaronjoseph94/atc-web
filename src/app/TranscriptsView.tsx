/**
 * The full conversation between the tower and the pilots, big and readable,
 * and searchable. Only what was said on the radio: detected takeoffs,
 * landings and go-arounds are listed under Recent activity in the traffic
 * panel instead.
 *
 * Live: every radio call heard at this airport (today's, kept across
 * reloads), under "Now", "10 min ago"… headings. Type to filter as you go,
 * with the matches lit; narrow to this channel, one callsign or your flight;
 * or tap a chip for the phrases people look for ("go around", "hold
 * short"…). Tapping a call replays its audio (the last fifty calls are
 * kept), lights up the aircraft, and redraws its taxi route if it was a
 * taxi clearance.
 *
 * In a replay: every spoken cue, searchable the same way; tap one to jump there.
 *
 * Phones get a full-height sheet; wide screens a panel docked at the right,
 * so the map stays in view and in reach.
 */
import { AudioLines, Play, Plane, Route, Search, X } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AirlineLogo } from '../airline/AirlineLogo'
import { getAirport, resolveStation } from '../api/airports'
import { formatMhz } from '../api/airportData'
import { useNow } from '../hooks/useNow'
import { findClip, loadClipIndex, playClip, startClipCapture, stopClip, useClips } from '../live/history/clips'
import { callsignSuggestions, groupByTime, highlight, NO_FILTERS, PHRASES, search, type Filters, type Hit, type Range, type SearchItem } from '../live/history/search'
import { startHistory, useHistory, type HistoryEntry } from '../live/history/store'
import { useRadio } from '../live/radio/radioStore'
import { releaseFocus } from '../live/radio/transcriber'
import { liveBuffer } from '../live/session'
import { parseTaxi } from '../live/taxi/parse'
import { showTaxiRoute } from '../live/taxi/watch'
import { trackId } from '../playback/interpolate'
import { formatClock } from '../playback/Timeline'
import { usePlayhead } from '../playback/playheadStore'
import { PanelFrame } from '../ui/Panel'
import { ATC_COLORS, PILOT_COLORS } from '../ui/speaker'

/** How rewind clips label their tower-log lines (src/live/recorder.ts); not radio, so not shown here. */
const TOWER_LOG_SPEAKER = 'Tower log'

/** Rows rendered at first; older ones come in pages, so a long day stays quick to draw. */
const PAGE = 120
/** Within this of the bottom, new calls keep the list scrolled to the newest. */
const STICK_PX = 140

type CueItem = SearchItem & { source: 'cue'; startMs: number; endMs: number; label: string; key: string | null }
type Item = HistoryEntry | CueItem

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })

/** Keep the history and the call audio from the moment the app starts, not when this panel opens. */
function useHistoryRecorder(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const stopHistory = startHistory()
    const stopClips = startClipCapture()
    void loadClipIndex()
    return () => {
      stopHistory()
      stopClips()
      stopClip()
    }
  }, [enabled])
}

/** Light up the aircraft a call was about while its audio plays. */
let lightTimer = 0
function lightUp(ids: string[], speaker: HistoryEntry['speaker'], ms: number) {
  const live = ids.filter((id) => liveBuffer.get(id))
  if (!live.length) return false
  const until = Date.now() + Math.max(ms, 2500) + 1500
  useRadio.getState().patch({ focus: { ids: live, speaker, until } })
  usePlayhead.getState().setActive(live[0], speaker)
  window.clearTimeout(lightTimer)
  lightTimer = window.setTimeout(releaseFocus, until - Date.now())
  return true
}

/** `docked`: rendered in the desktop side panel instead of as a sheet. */
export function TranscriptsView({ docked = false }: { docked?: boolean }) {
  // The sheet instance is always mounted (the docked one comes and goes with its tab), so it keeps the history.
  useHistoryRecorder(!docked)
  const open = usePlayhead((s) => s.panel === 'transcripts') || docked
  const setPanel = usePlayhead((s) => s.setPanel)
  const mode = usePlayhead((s) => s.mode)
  const clip = usePlayhead((s) => s.clip)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const close = useCallback(() => setPanel(null), [setPanel])
  const playback = mode === 'playback' && !!clip
  const airport = getAirport(airportIcao)
  const station = resolveStation(airport, stationId)
  const title = playback ? 'Transcript' : 'Transcripts'
  const subtitle = `${airport.icao} ${station?.label ?? ''}${station?.frequencyMhz != null ? `, ${formatMhz(station.frequencyMhz)}` : ''}`
  return (
    <PanelFrame docked={docked} open={open} title={title} onClose={close} tone="black">
      {/* Only instantiated while the sheet is mounted (including its exit) or the docked tab is showing. */}
      <TranscriptBody docked={docked} onClose={close} subtitle={subtitle} />
    </PanelFrame>
  )
}

function Chip({ active, onClick, children, label, tone = 'plain', disabled }: { active?: boolean; onClick: () => void; children: ReactNode; label?: string; tone?: 'plain' | 'purple'; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`pressable-soft flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-footnote font-semibold transition-colors duration-[var(--duration-fast)] disabled:opacity-35 ${
        tone === 'purple' ? 'bg-atc-card text-white' : active ? 'bg-white text-black' : 'bg-white/[0.09] text-white/75 enabled:hover:bg-white/[0.15] enabled:hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function Marked({ text, ranges }: { text: string; ranges: Range[] }) {
  if (!ranges.length) return <>{text}</>
  return (
    <>
      {highlight(text, ranges).map((r, i) =>
        r.hit ? (
          <mark key={i} className="rounded-[5px] bg-atc-yellow/25 px-[2px] text-atc-yellow">
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  )
}

/** Three bars that bounce while a call's audio plays. */
function PlayingBars() {
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
      {[0, 160, 320].map((d) => (
        <span key={d} className="w-[3px] origin-bottom rounded-full bg-current" style={{ height: '100%', animation: `tt-eq 0.8s ${d}ms ease-in-out infinite alternate` }} />
      ))}
    </span>
  )
}

function TranscriptBody({ docked, onClose, subtitle }: { docked: boolean; onClose: () => void; subtitle: string }) {
  const mode = usePlayhead((s) => s.mode)
  const clip = usePlayhead((s) => s.clip)
  // The clock only matters in a replay; live, the list shouldn't re-render on every tick.
  const tMs = usePlayhead((s) => (s.mode === 'playback' ? s.tMs : 0))
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const selectedIcao = usePlayhead((s) => s.selectedIcao)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const select = usePlayhead((s) => s.select)
  const entries = useHistory((s) => s.entries)
  const lastFlight = useHistory((s) => s.lastFlight)
  const clipIndex = useClips((s) => s.index)
  const playingId = useClips((s) => s.playing)
  const transcripts = useRadio((s) => s.transcripts)
  const radioOn = useRadio((s) => s.on && s.status !== 'off' && s.status !== 'nofeed')
  const now = useNow(20_000)

  const playback = mode === 'playback' && !!clip
  const airport = getAirport(airportIcao)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const query = useDeferredValue(filters.query)
  const [limit, setLimit] = useState(PAGE)
  const myFlight = selectedIcao ?? lastFlight
  const patch = (p: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...p }))
    setLimit(PAGE)
    // A new search starts at its newest match (the bottom); a replay keeps its place.
    if (!playback) requestAnimationFrame(() => requestAnimationFrame(() => listEnd.current?.scrollIntoView({ block: 'end' })))
  }

  // ---- what there is to search ----------------------------------------------
  const cues = playback ? clip.cues : null
  const items: Item[] = useMemo(() => {
    // Radio only: the tower-log events in the history (and in rewind clips) belong to Recent activity.
    if (!cues || !clip) return entries.filter((e) => e.source === 'radio')
    return cues.filter((c) => c.speaker !== TOWER_LOG_SPEAKER).map((c): CueItem => {
      const label = c.callsign ? (clip.aircraft?.[c.callsign]?.callsign ?? c.callsign).toUpperCase() : (c.speaker ?? '')
      return { id: c.id, source: 'cue', at: c.startMs, startMs: c.startMs, endMs: c.endMs, text: c.text, stationId: '', callsigns: label ? [label] : [], ids: c.callsign ? [trackId(c.callsign)] : [], label, key: c.callsign ?? null }
    })
  }, [cues, clip, entries])

  const active = useMemo((): Filters => ({ ...filters, query, stationId: filters.stationId ? stationId : null, icao24: filters.icao24 ? myFlight : null }), [filters, query, stationId, myFlight])
  const hits = useMemo(() => search(items, active), [items, active])
  const shown = hits.slice(-limit)
  const groups = useMemo(() => (playback ? [{ label: clip?.title ?? 'Replay', key: 'replay', hits: shown }] : groupByTime(shown, now)), [playback, clip, shown, now])
  const suggestions = useMemo(() => (filters.callsign ? [] : callsignSuggestions(items, query)), [items, query, filters.callsign])
  const filtering = !!(query || filters.phrase || filters.stationId || filters.callsign || filters.icao24)
  const activeCue = playback ? clip?.cues.find((c) => tMs >= c.startMs && tMs < c.endMs)?.id : undefined
  const withAudio = useMemo(() => new Set(hits.filter((h) => h.item.source === 'radio' && findClip(clipIndex, h.item.stationId, h.item.at, (h.item as HistoryEntry).durationMs)).map((h) => h.item.id)), [hits, clipIndex])

  // ---- scrolling ----------------------------------------------------------------
  const listEnd = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLLIElement>(null)
  const [headH, setHeadH] = useState(0)
  // Rows present when the panel opened don't animate in; only new arrivals do.
  const [initial] = useState(() => new Set(items.map((i) => i.id)))

  useLayoutEffect(() => {
    const el = head.current
    if (!el) return
    // The side panel fades content at its top edge; start that fade below the pinned search box.
    const fade = docked ? el.closest<HTMLElement>('.scroll-fade') : null
    const ro = new ResizeObserver(() => {
      setHeadH(el.offsetHeight)
      fade?.style.setProperty('--fade-offset', `${el.offsetHeight}px`)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [docked])

  // Open at the newest.
  useLayoutEffect(() => {
    if (!playback) listEnd.current?.scrollIntoView({ block: 'end' })
  }, [playback])

  // Newest at the bottom, like a chat: follow new calls if already at the bottom.
  const newest = hits[hits.length - 1]?.item.id
  const stuck = useRef(true)
  useEffect(() => {
    const el = listEnd.current?.closest<HTMLElement>('.overflow-y-auto')
    if (!el) return
    const on = () => (stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX)
    el.addEventListener('scroll', on, { passive: true })
    return () => el.removeEventListener('scroll', on)
  }, [])
  useEffect(() => {
    if (newest && !playback && stuck.current) listEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [newest, playback])
  // In a replay, keep the line being spoken in view.
  useEffect(() => {
    if (playback && activeCue) activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [playback, activeCue])

  // ---- actions --------------------------------------------------------------------
  const openCall = async (e: HistoryEntry) => {
    const meta = findClip(clipIndex, e.stationId, e.at, e.durationMs)
    // Started straight from the tap, so the browser lets it make sound.
    const playing = meta ? playClip(meta, e.id, e.at, e.durationMs) : Promise.resolve(null)
    const lit = lightUp(e.ids, e.speaker, (await playing) ?? 0)
    if (e.ids[0] && parseTaxi(e.text)) void showTaxiRoute(e.text, e.ids[0], e.airport)
    if (!meta && e.ids[0] && liveBuffer.get(e.ids[0])) select(e.ids[0])
    // On a phone the sheet covers the map: get out of the way so the aircraft can be seen.
    if (!docked && (lit || !meta)) onClose()
  }
  const openCue = (c: CueItem) => {
    setTMs(c.startMs)
    setPlaying(true)
    if (c.key && clip?.kind === 'rewind') select(trackId(c.key))
    if (!docked) onClose()
  }

  // ---- rendering ----------------------------------------------------------------------
  // The sheet's body is inset 16 px (20 on wider screens); the side panel's 16 px throughout.
  const gutter = docked ? '-mx-4 px-4' : '-mx-4 px-4 md:-mx-5 md:px-5'
  const stationLabel = (id: string) => resolveStation(airport, id)?.label ?? ''
  const radioCount = items.length
  const empty = !filtering && hits.length === 0

  return (
    <div className="relative">
      <style>{'@keyframes tt-eq { from { transform: scaleY(0.25) } to { transform: scaleY(1) } }'}</style>
      <div ref={head} className={`sticky top-0 z-20 pb-2.5 ${gutter} ${docked ? 'bg-atc-panel' : 'bg-black'}`}>
        <p className="-mt-1.5 mb-3 px-1 text-footnote text-white/55">{subtitle}</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-white/45" strokeWidth={2.25} />
          <input
            type="search"
            enterKeyHint="search"
            aria-label="Search transcripts"
            placeholder={playback ? 'Search this replay' : 'Search calls, callsigns, runways'}
            value={filters.query}
            onChange={(e) => patch({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filters.query) {
                e.stopPropagation()
                patch({ query: '' })
              }
            }}
            className="h-11 w-full appearance-none rounded-full bg-white/[0.09] pl-10 pr-10 text-body text-white outline-none ring-1 ring-inset ring-white/[0.06] transition-[background-color,box-shadow] duration-[var(--duration-fast)] placeholder:text-white/40 focus:bg-white/[0.12] focus:ring-2 focus:ring-atc-purple/80 [&::-webkit-search-cancel-button]:hidden"
          />
          {filters.query && (
            <button type="button" aria-label="Clear search" className="pressable absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white/80 hover:bg-white/25" onClick={() => patch({ query: '' })}>
              <X className="size-3.5" strokeWidth={2.75} />
            </button>
          )}
        </div>
        <div className={`no-scrollbar mt-2.5 flex gap-1.5 overflow-x-auto ${gutter}`} role="toolbar" aria-label="Filters">
          {!playback && (
            <Chip active={!!filters.stationId} onClick={() => patch({ stationId: filters.stationId ? null : stationId })} label="Only calls on this channel">
              This channel
            </Chip>
          )}
          <Chip active={!!filters.icao24} disabled={!myFlight} onClick={() => patch({ icao24: filters.icao24 ? null : myFlight })} label={myFlight ? 'Only calls about your flight' : 'Select a flight on the map first'}>
            <Plane className="size-3.5" strokeWidth={2.5} />
            My flight
          </Chip>
          {filters.callsign && (
            <Chip tone="purple" onClick={() => patch({ callsign: null })} label={`Remove the ${filters.callsign} filter`}>
              {filters.callsign}
              <X className="size-3.5" strokeWidth={2.75} />
            </Chip>
          )}
          <span className="mx-0.5 my-1.5 w-px shrink-0 bg-white/15" aria-hidden />
          {PHRASES.map((p) => (
            <Chip key={p.id} active={filters.phrase === p.id} onClick={() => patch({ phrase: filters.phrase === p.id ? null : p.id })}>
              {p.label}
            </Chip>
          ))}
        </div>
        {suggestions.length > 0 && (
          <div className="animate-fade mt-2 flex flex-wrap items-center gap-1.5 px-1">
            <span className="text-caption font-medium text-white/45">Callsigns</span>
            {suggestions.map((c) => (
              <button key={c} type="button" className="pressable-soft flex h-7 items-center gap-1.5 rounded-full bg-atc-card/25 px-2.5 text-caption font-bold text-white ring-1 ring-inset ring-atc-card/60 hover:bg-atc-card/45" onClick={() => patch({ callsign: c, query: '' })}>
                <AirlineLogo callsign={c} icao24={null} height={12} maxWidth={20} />
                {c}
              </button>
            ))}
          </div>
        )}
        {filtering && (
          <p className="mt-2 px-1 text-caption font-medium text-white/50" aria-live="polite">
            {hits.length === 0 ? 'No matches' : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`}
            {withAudio.size > 0 && ` · ${withAudio.size} with audio`}
          </p>
        )}
      </div>

      {empty ? (
        <EmptyState playback={playback} radioOn={radioOn} transcripts={transcripts} />
      ) : hits.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-body font-semibold">Nothing matches</p>
          <p className="mx-auto mt-1.5 max-w-xs text-footnote text-white/50">
            {query ? `No call says “${query}”` : 'No calls fit these filters'}
            {!playback && radioCount === 0 ? '. Calls are written out here once the radio is playing.' : '.'}
          </p>
          <button type="button" className="pressable-soft mt-4 rounded-full bg-white/10 px-4 py-2 text-footnote font-semibold hover:bg-white/15" onClick={() => patch(NO_FILTERS)}>
            Clear search and filters
          </button>
        </div>
      ) : (
        <>
          {hits.length > shown.length && (
            <button type="button" className="pressable-soft mx-auto my-3 block rounded-full bg-white/10 px-4 py-2 text-footnote font-semibold hover:bg-white/15" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, hits.length - shown.length)} earlier
            </button>
          )}
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h3 className={`sticky z-10 flex items-baseline justify-between pb-1.5 pt-3 text-caption font-semibold uppercase tracking-[0.06em] text-white/45 ${docked ? '-mx-4 bg-atc-panel px-5' : '-mx-4 bg-black px-5 md:-mx-5 md:px-6'}`} style={{ top: headH }}>
                <span>{g.label}</span>
                {!playback && g.hits[0] && <span className="font-medium normal-case tracking-normal tabular-nums text-white/35">{new Date(g.hits[0].item.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
              </h3>
              <ol className="flex flex-col gap-0.5">
                {g.hits.map((h: Hit<Item>) => {
                  const it = h.item
                  const fresh = !initial.has(it.id)
                  const rowClass = fresh ? 'animate-rise' : ''
                  if (it.source === 'cue') {
                    const isActive = it.id === activeCue
                    const past = it.endMs <= tMs
                    return (
                      <li key={it.id} ref={isActive ? activeRef : undefined} className={rowClass} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 84px' }}>
                        <button type="button" aria-current={isActive || undefined} className={`pressable-soft w-full rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.07] ${isActive ? 'bg-white/10' : ''}`} onClick={() => openCue(it)}>
                          <span className="flex items-center gap-2 text-caption font-medium text-white/45">
                            <span className="flex items-center gap-1.5 font-semibold text-white/65">
                              {it.key && <AirlineLogo callsign={it.label} icao24={trackId(it.key)} height={14} maxWidth={24} />}
                              {it.label}
                            </span>
                            <span className="tabular-nums">{clip?.startedAt != null ? new Date(clip.startedAt + it.startMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : formatClock(it.startMs)}</span>
                          </span>
                          <span className={`mt-0.5 block text-title3 font-semibold transition-colors duration-[var(--duration-base)] ${isActive || filtering ? 'text-white' : past ? 'text-white/80' : 'text-white/40'}`}>
                            <Marked text={it.text} ranges={h.ranges} />
                          </span>
                        </button>
                      </li>
                    )
                  }
                  const who = it.callsigns[0]
                  const role = it.speaker === 'pilot' ? 'Pilot' : it.speaker === 'controller' ? 'Controller' : null
                  const audio = withAudio.has(it.id)
                  const isPlaying = playingId === it.id
                  const taxi = it.ids.length > 0 && /\btaxi|\bvia\b/i.test(it.text) && !!parseTaxi(it.text)
                  return (
                    <li key={it.id} className={rowClass} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 96px' }}>
                      <button
                        type="button"
                        className={`pressable-soft flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07] ${isPlaying ? 'bg-atc-card/20 ring-1 ring-inset ring-atc-card/50' : ''}`}
                        onClick={() => void openCall(it)}
                        aria-label={`${who ?? 'Call'} at ${clock(it.at)}${audio ? ', play audio' : ''}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 text-caption font-medium text-white/45">
                            {who && (
                              <span className="flex items-center gap-1.5 font-semibold" style={{ color: it.speaker === 'pilot' ? PILOT_COLORS.light : it.speaker === 'controller' ? ATC_COLORS.light : 'rgb(255 255 255 / 0.7)' }}>
                                <AirlineLogo callsign={who} icao24={it.ids[0] ?? null} height={13} maxWidth={22} />
                                {filters.callsign || query ? <Marked text={who} ranges={rangesIn(who, query)} /> : who}
                              </span>
                            )}
                            {role && <span>{role}</span>}
                            {!filters.stationId && it.stationId !== stationId && <span className="text-white/35">{stationLabel(it.stationId)}</span>}
                            <span className="tabular-nums">{clock(it.at)}</span>
                          </span>
                          <span className="mt-0.5 block text-[21px] font-semibold leading-snug text-white/90">
                            <Marked text={it.text} ranges={h.ranges} />
                          </span>
                          {taxi && (
                            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-atc-card/30 px-2 py-0.5 text-caption font-semibold text-[#C9BCFF]">
                              <Route className="size-3" strokeWidth={2.5} />
                              Taxi route
                            </span>
                          )}
                        </span>
                        {audio && (
                          <span className={`mt-1 grid size-9 shrink-0 place-items-center rounded-full transition-colors ${isPlaying ? 'bg-atc-card text-white' : 'bg-white/10 text-white/80'}`} aria-hidden>
                            {isPlaying ? <PlayingBars /> : <Play className="ml-0.5 size-4" fill="currentColor" strokeWidth={0} />}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
        </>
      )}
      {playback && hits.length > 0 && <p className="py-6 text-center text-caption text-white/35">Tap a line to jump the replay there.</p>}
      {!playback && radioCount > 0 && hits.length > 0 && (
        <p className="flex items-center justify-center gap-1.5 py-6 text-center text-caption text-white/35">
          <AudioLines className="size-3.5" />
          Live audio from LiveATC.net. Transcripts are machine-made and can be wrong.
        </p>
      )}
      <div ref={listEnd} />
    </div>
  )
}

/** Where a typed query appears in a callsign label, for lighting it. */
function rangesIn(label: string, query: string): Range[] {
  const q = query.trim().toUpperCase().replace(/\s+/g, '')
  if (!q) return []
  const i = label.toUpperCase().indexOf(q)
  return i >= 0 ? [[i, i + q.length]] : []
}

function EmptyState({ playback, radioOn, transcripts }: { playback: boolean; radioOn: boolean; transcripts: string }) {
  if (playback) return <p className="py-10 text-center text-subhead text-atc-muted">Nobody spoke during this stretch. Scrub the timeline to hear the next call.</p>
  return (
    <div className="py-10 text-center">
      <p className="text-body font-semibold">{radioOn ? 'Listening' : 'No calls yet'}</p>
      <p className="mx-auto mt-2 max-w-sm text-footnote leading-relaxed text-atc-muted">
        {radioOn
          ? transcripts === 'unavailable'
            ? 'Written transcripts only work on the published site. The audio still plays here.'
            : 'Each call on this channel is written out here a moment after it is spoken, and kept for a day so you can search it.'
          : 'Press play on the station bar to hear this channel; calls appear here as they’re spoken.'}
      </p>
    </div>
  )
}
