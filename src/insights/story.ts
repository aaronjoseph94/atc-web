/**
 * Flight story: this flight's life at the airport as a short paragraph,
 * built from its timeline (the phases the app watched), the tower log and
 * the radio calls naming it. `buildStoryInput` collects what is known;
 * `fallbackStory` tells it with a template when there is no AI.
 */
import type { FlightStoryInput } from '../api/ai/tasks/flightStory'
import { stepLabel, type Step, type Timeline } from '../flight/timeline'

export type StoryData = {
  callsign: string
  /** "United flight 1534", or the callsign. */
  name: string
  airline: string | null
  aircraft: string | null
  from: string | null
  to: string | null
  airport: string
  timeline: Timeline
  events: { at: number; text: string }[]
  calls: { at: number; speaker: string | null; text: string }[]
  /** Times on the timeline's clock → text. */
  clock: (t: number) => string
}

/** The phases worth telling, in order: seen ones, with times. */
function toldSteps(t: Timeline): Step[] {
  return t.steps.filter((s) => (s.state === 'done' || s.state === 'current') && s.at != null && s.key !== 'rollout' && s.key !== 'climb')
}

export function buildStoryInput(d: StoryData): FlightStoryInput {
  const steps = toldSteps(d.timeline)
  const current = d.timeline.steps.find((s) => s.key === d.timeline.current)
  return {
    callsign: d.callsign,
    flight: d.name !== d.callsign ? d.name : null,
    airline: d.airline,
    aircraft: d.aircraft,
    from: d.from,
    to: d.to,
    airport: d.airport,
    role: d.timeline.role,
    steps: steps.slice(-16).map((s) => ({ time: d.clock(s.at!), what: `${stepLabel(s, d.timeline.role)}${s.inProgress ? ' (already under way when first seen)' : ''}`, runway: s.runway })),
    events: d.events.slice(-8).map((e) => ({ time: d.clock(e.at), text: e.text })),
    radio: d.calls.slice(-10).map((c) => ({ time: d.clock(c.at), speaker: c.speaker ?? 'radio', text: c.text })),
    // The phase, not a sentence with distances in it: this is part of the cache key and must not change every second.
    now: current ? stepLabel(current, d.timeline.role) : null,
  }
}

/** One clause per phase, for the template. */
const CLAUSE: Record<string, (time: string, rwy: string | null) => string> = {
  pushback: (t) => `pushed back at ${t}`,
  taxiOut: (t) => `started taxiing at ${t}`,
  lineUp: (t, r) => `lined up on ${r ? `runway ${r}` : 'the runway'} at ${t}`,
  takeoffRoll: (t, r) => `began its takeoff roll${r ? ` on ${r}` : ''} at ${t}`,
  airborne: (t, r) => `was airborne${r ? ` from ${r}` : ''} at ${t}`,
  level: (t) => `levelled off at ${t}`,
  descent: (t) => `started down at ${t}`,
  approach: (t, r) => `was on final${r ? ` for ${r}` : ''} at ${t}`,
  goAround: (t) => `went around at ${t}`,
  touchdown: (t, r) => `touched down${r ? ` on ${r}` : ''} at ${t}`,
  taxiIn: (t) => `taxied in at ${t}`,
  atGate: (t) => `came to a stop at ${t}`,
}

/** What it was doing, for "first seen …" and "now …". */
const DOING: Record<string, string> = {
  pushback: 'pushing back',
  taxiOut: 'taxiing',
  lineUp: 'lined up on the runway',
  takeoffRoll: 'on its takeoff roll',
  airborne: 'just airborne',
  climb: 'climbing',
  level: 'flying level',
  descent: 'descending',
  approach: 'on final approach',
  goAround: 'going around',
  touchdown: 'touching down',
  rollout: 'slowing on the runway',
  taxiIn: 'taxiing in',
  atGate: 'parked',
}

const ROLE_INTRO: Record<string, string> = { departure: 'departing', arrival: 'arriving', both: 'flying circuits', overflight: 'passing overhead', ground: 'on the ground' }

/** The template story: who it is, then what it did, in order. */
export function fallbackStory(d: StoryData): string {
  const input = buildStoryInput(d)
  const name = input.flight ?? input.callsign
  const about = [input.aircraft ? `${/^[AEIOU]/i.test(input.aircraft) ? 'an' : 'a'} ${input.aircraft}` : null, input.to && input.role !== 'arrival' ? `bound for ${input.to}` : input.from && input.role === 'arrival' ? `in from ${input.from}` : null].filter(Boolean).join(' ')
  const clauses = toldSteps(d.timeline)
    .slice(-5)
    .map((s) => {
      const time = d.clock(s.at!)
      if (s.inProgress) return `was first seen ${DOING[s.key] ?? stepLabel(s, d.timeline.role).toLowerCase()} at ${time}`
      return CLAUSE[s.key]?.(time, s.runway) ?? `${stepLabel(s, d.timeline.role).toLowerCase()} at ${time}`
    })
  const out: string[] = []
  const told = clauses.length > 1 ? `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}` : clauses[0]
  out.push(`${name}${about ? `, ${about},` : ''} ${told ?? `is ${ROLE_INTRO[input.role] ?? 'here'} at ${input.airport}`}.`)
  const current = d.timeline.current
  const last = toldSteps(d.timeline).at(-1)
  // "Now" only when it adds something: not when the last thing told is the very same phase.
  if (current && clauses.length && !(last?.key === current && last.inProgress)) out.push(`It is now ${DOING[current] ?? stepLabel({ key: current, altitudeFt: null }, d.timeline.role).toLowerCase()}.`)
  const call = input.radio[input.radio.length - 1]
  if (call) out.push(`Last heard on the radio at ${call.time}: “${call.text.length > 80 ? `${call.text.slice(0, 79)}…` : call.text}”`)
  else if (input.events.length) out.push(input.events[input.events.length - 1].text)
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

/** When the story is worth asking for again: a new phase, event or call. */
export function storyKey(input: FlightStoryInput): string {
  return [input.callsign, input.steps.length, input.steps[input.steps.length - 1]?.what, input.events.length, input.radio.length].join('|')
}
