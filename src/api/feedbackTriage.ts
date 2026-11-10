/**
 * Feedback triage without AI, and the shapes both triages share: a category,
 * a severity, a one-line summary and the part of the app it most likely
 * concerns (from a short map of the app's modules, which the AI task is
 * given too). Pure, so the server can always fall back to it.
 */

export const CATEGORIES = ['bug', 'idea', 'data', 'question'] as const
export type FeedbackCategory = (typeof CATEGORIES)[number]
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type FeedbackSeverity = (typeof SEVERITIES)[number]

/** The app's modules, for "where in the code is this". Keys are stable (they become issue labels). */
export const AREAS: Record<string, { label: string; paths: string; words: RegExp }> = {
  map: { label: 'Map and aircraft drawing', paths: 'src/map/**, src/aircraft/**', words: /\b(map|zoom|pan|tag|label|icon|plane icon|aircraft icon|shadow|trail|camera|satellite|chart|tiles?)\b/i },
  airfield: { label: 'Runways, taxiways and gates', paths: 'src/map/airportDiagram.ts, src/live/taxi/**, src/live/gates.ts', words: /\b(runway|taxiway|taxi ?line|gate|apron|ramp|terminal|hold ?short)\b/i },
  traffic: { label: 'Traffic list, recent activity and spotting', paths: 'src/app/TrafficPanel.tsx, src/app/ActivityList.tsx, src/live/events.ts, src/discovery/**', words: /\b(traffic list|landing|landed|takeoff|take-off|departure|go-?around|activity|spotted|rare|military)\b/i },
  flight: { label: 'Flight card and details', paths: 'src/flight/**', words: /\b(flight card|card|route|origin|destination|timeline|altitude|speed|eta)\b/i },
  radio: { label: 'Live radio, transcripts and callsign matching', paths: 'src/live/radio/**, src/app/TranscriptsView.tsx', words: /\b(radio|audio|sound|listen|transcri\w*|caption|subtitle|liveatc|frequency|channel|tower|ground|atis)\b/i },
  replay: { label: 'Replays and recorded scenes', paths: 'src/playback/**, src/app/ReplayPanel.tsx, public/clips', words: /\b(replay|rewind|scene|playback|timeline scrub)\b/i },
  weather: { label: 'Weather, METAR, TAF and ATIS', paths: 'src/weather/**, src/api/weatherHandler.ts', words: /\b(weather|metar|taf|wind|visibility|cloud|rain|snow|radar)\b/i },
  airlines: { label: 'Airline names and logos', paths: 'src/airline/**', words: /\b(airline|logo|brand|carrier)\b/i },
  'aircraft-data': { label: 'Aircraft type facts', paths: 'src/aircraft/types.ts', words: /\b(aircraft type|type is wrong|wingspan|seats|range|engine|manufacturer)\b/i },
  feeds: { label: 'Live data feeds and the server API', paths: 'src/api/**, functions/api/**', words: /\b(feed|offline|no planes|no aircraft|missing aircraft|delay|lag|api|server|loading)\b/i },
  settings: { label: 'Settings and preferences', paths: 'src/settings/**', words: /\b(settings?|preference|units?|metres|feet|knots)\b/i },
  ai: { label: 'AI features', paths: 'src/ai/**, src/api/ai/**', words: /\b(ai|claude|openrouter|api key|summary|summaries)\b/i },
  shell: { label: 'App layout, menu and panels', paths: 'src/app/**, src/ui/**, src/station/**', words: /\b(menu|button|panel|sheet|layout|scroll|keyboard|shortcut|font|text size|install|pwa|iphone|android|ipad|desktop)\b/i },
}

export type Triage = {
  category: FeedbackCategory
  severity: FeedbackSeverity
  /** One line, under 100 characters. */
  summary: string
  /** A key of `AREAS`, or `other`. */
  area: string
  /** What to look at or change, when it can be said; null from the rules. */
  suggestedFix: string | null
}

const BUG = /\b(bug|broken|break|breaks|crash\w*|error|doesn'?t work|does not work|not working|won'?t|can'?t|cannot|wrong|freez\w*|stuck|blank|black screen|white screen|missing|fail\w*|glitch\w*|jump\w*|flicker\w*|slow|lag\w*|disappear\w*|cut(s|ting)? out|drop(s|ped|ping)? out|stops|stopped|overlap\w*|hid(e|es|ing)|cover(s|ed|ing)|cut off|unreadable|off-?screen)\b/i
const IDEA = /\b(would be (nice|great|cool)|could you|can you add|please add|feature|suggest\w*|wish|idea|it'?d be|add an? |allow|option to|let me)\b/i
const DATA = /\b(wrong|incorrect|outdated|misspel\w*|not the right|should be|isn'?t called|is called|mislabel\w*)\b/i
const DATA_THING = /\b(airline|logo|type|callsign|runway|frequency|airport|name|registration|gate|taxiway|elevation|seats|wingspan|range)\b/i
const QUESTION = /^(how|why|what|where|when|which|who|can i|is there|is it|does|do you|are)\b/i
const CRITICAL = /\b(crash\w*|(goes|went|turns|is) (blank|black|white)|black screen|white screen|blank screen|won'?t (load|open|start)|unusable|lost (all|my)|security|password|leak\w*)\b/i
const HIGH = /\b(can'?t use|cannot use|nothing (loads|works|shows)|no (planes|aircraft) at all|every time|always fails)\b/i

/** First sentence, tidied and cut to fit a title. */
export function summarize(text: string, max = 96): string {
  const one = text.replace(/\s+/g, ' ').trim()
  const first = /^(.{12,}?[.!?])(\s|$)/.exec(one)?.[1] ?? one
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first
}

/** The most likely area from keywords; `other` when nothing matches. */
export function guessArea(text: string): string {
  let best = 'other'
  let hits = 0
  for (const [key, a] of Object.entries(AREAS)) {
    const n = (text.match(new RegExp(a.words.source, 'gi')) ?? []).length
    if (n > hits) {
      best = key
      hits = n
    }
  }
  return best
}

/** Keyword triage: the fallback when no AI is configured or it fails. */
export function ruleTriage(text: string): Triage {
  const t = text.trim()
  const bug = BUG.test(t)
  let category: FeedbackCategory
  if (DATA.test(t) && DATA_THING.test(t)) category = 'data'
  else if (bug) category = 'bug'
  else if (IDEA.test(t)) category = 'idea'
  else if (QUESTION.test(t) || /\?\s*$/.test(t)) category = 'question'
  else category = 'idea'
  const severity: FeedbackSeverity = CRITICAL.test(t) ? 'critical' : HIGH.test(t) ? 'high' : category === 'bug' ? 'medium' : 'low'
  return { category, severity, summary: summarize(t) || 'Feedback', area: guessArea(t), suggestedFix: null }
}

/**
 * Check an AI answer against the shape and the allowed values; null when it
 * doesn't fit (the caller then falls back to the rules).
 */
export function normalizeTriage(json: unknown): Triage | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  if (!CATEGORIES.includes(j.category as FeedbackCategory)) return null
  if (!SEVERITIES.includes(j.severity as FeedbackSeverity)) return null
  if (typeof j.summary !== 'string' || !j.summary.trim()) return null
  const area = typeof j.area === 'string' && (j.area in AREAS || j.area === 'other') ? j.area : 'other'
  const fix = typeof j.suggestedFix === 'string' && j.suggestedFix.trim() ? j.suggestedFix.trim().slice(0, 600) : null
  return { category: j.category as FeedbackCategory, severity: j.severity as FeedbackSeverity, summary: summarize(j.summary, 100), area, suggestedFix: fix }
}
