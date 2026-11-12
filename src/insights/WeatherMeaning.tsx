/**
 * "What it means": the weather panel's plain-English line on what the
 * report, forecast and ATIS mean for flying and for watching ("low cloud:
 * arrivals are on instruments; a 20 kt crosswind on 31L"). Built in, and
 * worded by the AI when a key is set (cached fifteen minutes per report).
 */
import type { Atis, Metar } from '../api/types'
import type { ActiveRunways } from '../live/runwayUse'
import type { RunwayEndGeometry } from '../map/airportDiagram'
import { useAiTask } from './ai'
import { AiMark } from './AiMark'
import { parseSummary } from './parse'
import { buildWeatherInput, fallbackWeather, forecastHeadline, windsOnRunways } from './weatherBrief'

export function WeatherMeaning({ airport, metar, taf, atis, active, ends }: { airport: string; metar: Metar; taf: string | null; atis: Atis[]; active: ActiveRunways | null; ends: RunwayEndGeometry[] }) {
  // The input is the AI request's identity (compared by value), so it must only change when the
  // report or the runways in use do: "now" for the forecast is the observation time, not the clock,
  // and only the runway sets are used, not their ever-changing scores.
  const now = Date.parse(metar.observedAt)
  const input = buildWeatherInput({ airport, metar, taf, atis, active, ends, now })
  const fallback = fallbackWeather(metar, windsOnRunways(metar, ends, active), forecastHeadline(taf, now))
  const ai = useAiTask('weatherBrief', input, parseSummary(400), 15 * 60_000)
  const text = ai.data ?? fallback
  if (!text) return null
  return (
    <section aria-label="What it means" className="ui-card mt-2 px-3.5 py-3">
      <div className="flex items-center gap-1 text-caption font-semibold text-white/60">
        What it means
        {ai.data && <AiMark />}
      </div>
      <p className="mt-1 text-subhead leading-snug text-white/90">{text}</p>
    </section>
  )
}
