/**
 * The built-in glossary for Learn mode: the phrases and abbreviations people
 * hear on the radio or read in the weather, each with a short plain-English
 * explanation (and a small diagram where a picture helps). Written by hand,
 * checked against the FAA's Pilot/Controller Glossary and ICAO phraseology,
 * and shipped with the app, so it works offline and without AI.
 *
 * `patterns` are what the term detector looks for in a line of text; the
 * first is the canonical spelling. They are matched case-insensitively
 * unless `caseSensitive` is set (for abbreviations that are also everyday
 * words, like STAR). `detail` adds a line about the exact words matched
 * ("FL350 is about 35,000 ft").
 */

export type DiagramId = 'holdShort' | 'luaw' | 'ils' | 'goAround' | 'runway' | 'pattern' | 'flightLevels' | 'crosswind' | 'papi' | 'hold' | 'clock'

export type TermCategory = 'Clearance' | 'Ground' | 'Approach' | 'Altitude' | 'Radio' | 'Emergency' | 'Weather' | 'Aircraft'

export type GlossaryEntry = {
  id: string
  /** How the term is shown as a heading. */
  term: string
  category: TermCategory
  patterns: RegExp[]
  caseSensitive?: boolean
  /** One to three short sentences. */
  text: string
  diagram?: DiagramId
  /** A line about the exact words matched, when there is something specific to say. */
  detail?: (match: string) => string | null
  /** Other words people might search the glossary with. */
  keywords?: string[]
}

const SIDE: Record<string, string> = { L: 'left', R: 'right', C: 'centre' }

/** `31R`, `31 right`, `9 left` → `{ number: 31, side: 'right' }`. */
export function parseRunway(text: string): { number: number; side: string | null } | null {
  const m = /(\d{1,2})\s*(L|R|C|left|right|cent(?:er|re))?\b/i.exec(text)
  if (!m) return null
  const number = Number(m[1])
  if (number < 1 || number > 36) return null
  const s = m[2]?.toUpperCase()
  return { number, side: s ? (SIDE[s[0]] ?? null) : null }
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
const compass8 = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]

function runwayDetail(match: string): string | null {
  const r = parseRunway(match.replace(/^\D*/, ''))
  if (!r) return null
  const heading = r.number * 10
  const other = ((r.number + 17) % 36) + 1
  const side = r.side ? `; it is the ${r.side}-hand one of the parallel runways` : ''
  return `Runway ${r.number}${r.side ? ` ${r.side}` : ''} points about ${heading}° (${compass8(heading)})${side}. The same strip of concrete is runway ${other} from the other end.`
}

const SQUAWK_MEANING: Record<string, string> = { '7500': 'unlawful interference (hijack)', '7600': 'radio failure', '7700': 'general emergency', '1200': 'VFR flight not talking to ATC (US and Canada)', '2000': 'IFR flight not yet assigned a code' }

export const GLOSSARY: GlossaryEntry[] = [
  // ---- Clearances ------------------------------------------------------------
  {
    id: 'luaw',
    term: 'Line up and wait',
    category: 'Clearance',
    patterns: [/\b(?:line|lined|lining)\s*up\s+(?:and|&|n)\s+wait\b/, /\bposition\s+and\s+hold\b/],
    text: 'Taxi onto the runway, line up on the centreline and stop there. It is not a takeoff clearance: the controller is getting you ready while something else finishes, such as a landing or a crossing.',
    diagram: 'luaw',
    keywords: ['LUAW', 'position and hold'],
  },
  {
    id: 'holdShort',
    term: 'Hold short',
    category: 'Ground',
    patterns: [/\bhold(?:ing)?\s+short(?:\s+of)?\b/],
    text: 'Stop before the named runway or taxiway, behind its hold-short line: two solid and two dashed yellow lines across the taxiway. The solid side faces the aircraft that must stop. Crossing it without permission is a runway incursion.',
    diagram: 'holdShort',
  },
  {
    id: 'takeoff',
    term: 'Cleared for takeoff',
    category: 'Clearance',
    patterns: [/\bclear(?:ed)?\s+(?:for\s+)?take\s*-?\s*off\b/],
    text: 'Permission to use the runway and take off. It always names the runway, so two aircraft can never both believe they have the same one.',
  },
  {
    id: 'land',
    term: 'Cleared to land',
    category: 'Clearance',
    patterns: [/\bclear(?:ed)?\s+(?:to\s+)?land\b/],
    text: 'The runway is reserved for this aircraft to land on. A pilot who has not heard it by the last moments of the approach goes around.',
  },
  {
    id: 'asFiled',
    term: 'Cleared as filed',
    category: 'Clearance',
    patterns: [/\b(?:cleared\s+to\s+.{1,30}?\s+)?as\s+filed\b/],
    text: 'Fly the route written in the flight plan, without changes. Saves the controller reading the whole route out.',
  },
  {
    id: 'cross',
    term: 'Cross runway',
    category: 'Ground',
    patterns: [/\bcross(?:ing)?\s+runway\s+\d{1,2}\s*(?:[LRC]\b|left|right|cent(?:er|re))?/],
    text: 'Permission to drive across a runway. Every runway is a stop by default; crossing one always needs this explicit instruction, read back by the pilot.',
    detail: runwayDetail,
  },
  {
    id: 'pushback',
    term: 'Push back',
    category: 'Ground',
    patterns: [/\bpush(?:ing)?\s*-?\s*back\b/, /\bpush\s+(?:approved|at\s+your\s+discretion)\b/],
    text: 'A tug pushes the aircraft backwards out of its gate; airliners don’t normally reverse under their own power. "Tail east" or "face north" tells the crew which way to end up pointing.',
  },
  {
    id: 'taxiVia',
    term: 'Taxi via',
    category: 'Ground',
    patterns: [/\btaxi\s+(?:to\s+.{1,30}?\s+)?via\b/],
    text: 'The route to drive on the ground, given as taxiway letters in order ("via Bravo, Charlie"). The aircraft must stop before any runway on the way unless told to cross.',
  },
  {
    id: 'vacate',
    term: 'Exit / vacate',
    category: 'Ground',
    patterns: [/\b(?:vacate|exit)\s+(?:the\s+runway|at|via|left|right|next)\b/],
    text: 'Leave the runway after landing, at the named taxiway, so the next aircraft can land. Fast "high-speed" exits let jets turn off without slowing right down.',
  },
  {
    id: 'holdPosition',
    term: 'Hold position',
    category: 'Ground',
    patterns: [/\bhold\s+position\b/],
    text: 'Stop exactly where you are on the ground and wait.',
  },
  {
    id: 'giveWay',
    term: 'Give way',
    category: 'Ground',
    patterns: [/\bgive\s+way\b/],
    text: 'Let the named aircraft go first, then follow.',
  },

  // ---- Approach and departure -----------------------------------------------
  {
    id: 'goAround',
    term: 'Go around',
    category: 'Approach',
    patterns: [/\bgo(?:ing)?[\s-]*around\b/],
    text: 'Abandon the landing: full power, climb away and come back for another try. Routine and safe. Common reasons: the runway isn’t clear yet, the approach isn’t stable, or gusts and wind shear.',
    diagram: 'goAround',
  },
  {
    id: 'missed',
    term: 'Missed approach',
    category: 'Approach',
    patterns: [/\bmissed\s+approach\b/],
    text: 'The published climb-out to follow when an instrument approach can’t be finished, for example when the runway isn’t in sight at the minimum height.',
    diagram: 'goAround',
  },
  {
    id: 'ils',
    term: 'ILS',
    category: 'Approach',
    patterns: [/\bI[\s.-]?L[\s.-]?S\b(?:\s+(?:approach\s+)?(?:to\s+)?(?:runway\s+)?\d{1,2}\s*(?:[LRC]\b|left|right|cent(?:er|re))?)?/, /\binstrument\s+landing\s+system\b/],
    text: 'Instrument Landing System: two radio beams from the runway guide an aircraft down through cloud. The localizer gives left–right, the glide slope gives up–down (usually a 3° path).',
    diagram: 'ils',
    detail: (m) => {
      const r = parseRunway(m.replace(/^\D*/, ''))
      return r ? `Here: the ILS approach to runway ${r.number}${r.side ? ` ${r.side}` : ''}.` : null
    },
  },
  {
    id: 'localizer',
    term: 'Localizer',
    category: 'Approach',
    patterns: [/\blocali[sz]er\b/],
    text: 'The ILS beam that gives left–right guidance onto the runway centreline. "Join the localizer" means turn onto it and follow it in.',
    diagram: 'ils',
  },
  {
    id: 'glideslope',
    term: 'Glide slope',
    category: 'Approach',
    patterns: [/\bglide\s*(?:slope|path)\b/],
    text: 'The ILS beam that gives up–down guidance: a steady descent, usually 3°, which is about 300 ft lower for every nautical mile closer to the runway.',
    diagram: 'ils',
  },
  {
    id: 'rnav',
    term: 'RNAV / RNP',
    category: 'Approach',
    patterns: [/\bRNAV\b/, /\bRNP\b/, /\barea\s+navigation\b/],
    text: 'Area navigation: flying precise GPS-defined paths between waypoints instead of to and from radio beacons. Many approaches and departures are built this way.',
  },
  {
    id: 'visual',
    term: 'Visual approach',
    category: 'Approach',
    patterns: [/\bvisual\s+approach\b/],
    text: 'The pilot flies to the runway by looking outside rather than following instrument guidance, once they report the airport (or the aircraft ahead) in sight.',
  },
  {
    id: 'final',
    term: 'Final',
    category: 'Approach',
    patterns: [/\b(?:short|long|on|turning)\s+final\b/, /\bfinal\s+approach\b/],
    text: 'The last straight leg of an approach, lined up with the runway. "Short final" is the last mile or so.',
    diagram: 'pattern',
  },
  {
    id: 'pattern',
    term: 'Downwind / base leg',
    category: 'Approach',
    patterns: [/\b(?:left|right)\s+(?:downwind|base)\b/, /\bdownwind\b/, /\bbase\s+leg\b/, /\bturn(?:ing)?\s+base\b/, /\btraffic\s+pattern\b/, /\bcircuit\b/],
    text: 'Legs of the rectangle flown around a runway to land: upwind, crosswind, downwind (parallel to the runway, going the other way), base, then final.',
    diagram: 'pattern',
  },
  {
    id: 'sid',
    term: 'SID',
    category: 'Approach',
    patterns: [/\bSID\b/, /\bstandard\s+instrument\s+departure\b/i],
    caseSensitive: true,
    text: 'Standard Instrument Departure: a published route from the runway up to the airways, with a name like "TRUKN 2". Saves reading out a long list of turns and heights.',
  },
  {
    id: 'star',
    term: 'STAR',
    category: 'Approach',
    patterns: [/\bSTAR\b/, /\bstandard\s+terminal\s+arrival\b/i],
    caseSensitive: true,
    text: 'Standard Terminal Arrival Route: a published path from the airways down toward the airport, ending where the approach begins.',
  },
  {
    id: 'holding',
    term: 'Holding pattern',
    category: 'Approach',
    patterns: [/\bholding\s+pattern\b/, /\bhold\s+as\s+published\b/, /\bexpect\s+further\s+clearance\b/],
    text: 'A racetrack loop flown over a fixed point to wait, usually for traffic or weather delays ahead. A standard lap takes about four minutes.',
    diagram: 'hold',
  },
  {
    id: 'minimums',
    term: 'Minimums',
    category: 'Approach',
    patterns: [/\bminimums\b/, /\bdecision\s+(?:height|altitude)\b/],
    text: 'The lowest height on an instrument approach at which the pilot must see the runway to carry on. Without it in sight, they go around.',
  },
  {
    id: 'papi',
    term: 'PAPI',
    category: 'Approach',
    patterns: [/\bPAPI\b/],
    caseSensitive: true,
    text: 'Precision Approach Path Indicator: four lights beside the runway. Two white and two red means on the glide path; more white is too high, more red is too low.',
    diagram: 'papi',
  },
  {
    id: 'lahso',
    term: 'LAHSO',
    category: 'Approach',
    patterns: [/\bLAHSO\b/i, /\bland\s+and\s+hold\s+short\b/],
    text: 'Land and hold short: cleared to land, but the aircraft must stop before an intersecting runway, so two crossing runways can be used at once.',
  },

  // ---- Altitudes, headings, routing -----------------------------------------
  {
    id: 'flightLevel',
    term: 'Flight level',
    category: 'Altitude',
    patterns: [/\bflight\s+level\s+\d{2,3}\b/, /\bFL\s?\d{2,3}\b/],
    text: 'Altitude in hundreds of feet with the altimeter set to standard pressure (29.92 inHg / 1013 hPa), used high up so everyone measures from the same reference. Below the transition altitude (18,000 ft in the US and Canada) altitudes are given in feet on the local setting.',
    diagram: 'flightLevels',
    detail: (m) => {
      const n = Number(/(\d{2,3})\s*$/.exec(m)?.[1])
      return Number.isFinite(n) ? `Flight level ${n} is about ${(n * 100).toLocaleString('en-US')} ft.` : null
    },
  },
  {
    id: 'climbMaintain',
    term: 'Climb and maintain',
    category: 'Altitude',
    patterns: [/\b(?:climb|descend)\s+(?:and\s+)?maintain\b/],
    text: 'Climb (or descend) to the given altitude and stay there until told otherwise. Pilots must read the number back.',
  },
  {
    id: 'pilotsDiscretion',
    term: 'Pilot’s discretion',
    category: 'Altitude',
    patterns: [/\bpilot'?s\s+discretion\b/],
    text: 'Start the climb or descent whenever the pilot chooses, rather than straight away.',
  },
  {
    id: 'altimeter',
    term: 'Altimeter / QNH',
    category: 'Altitude',
    patterns: [/\baltimeter\b/, /\bQNH\b/i],
    text: 'The air-pressure setting pilots dial into the altimeter so it reads height above sea level here. North America gives it in inches of mercury (29.92), most of the world in hectopascals (QNH 1013).',
    keywords: ['pressure', 'inHg', 'hPa'],
  },
  {
    id: 'heading',
    term: 'Fly heading',
    category: 'Altitude',
    patterns: [/\bfly\s+heading\b/, /\bturn\s+(?:left|right)\s+heading\b/, /\brunway\s+heading\b/],
    text: 'Steer this compass direction, in degrees (360 is north, 090 east). "Runway heading" means keep flying the way the runway points after takeoff.',
  },
  {
    id: 'vectors',
    term: 'Vectors',
    category: 'Altitude',
    patterns: [/\bvectors?\b/],
    text: 'Headings a radar controller gives to steer aircraft, to space them out or line them up for the approach.',
  },
  {
    id: 'direct',
    term: 'Direct',
    category: 'Altitude',
    patterns: [/\b(?:proceed|cleared|fly)\s+direct\b/, /\bdirect\s+to\b/],
    text: 'Fly straight to the named waypoint, skipping the route before it: a shortcut.',
  },

  // ---- Radio procedure ------------------------------------------------------
  {
    id: 'squawk',
    term: 'Squawk',
    category: 'Radio',
    patterns: [/\bsquawk(?:ing)?(?:\s+(?:code\s+)?\d{4}\b|\s+ident\b)?/],
    text: 'Set this four-digit code on the transponder, so the aircraft’s radar blip is labelled with its callsign. "Squawk ident" means press the button that makes the blip flash.',
    detail: (m) => {
      const code = /\d{4}/.exec(m)?.[0]
      if (!code) return null
      return SQUAWK_MEANING[code] ? `${code} means ${SQUAWK_MEANING[code]}.` : `${code} is just this flight’s own code.`
    },
  },
  {
    id: 'contact',
    term: 'Contact / monitor',
    category: 'Radio',
    patterns: [/\bcontact\s+(?:the\s+)?(?:ground|tower|departure|approach|center|centre|clearance|ramp)\b/, /\bmonitor\s+(?:ground|tower|departure|approach|center|centre)\b/],
    text: 'Switch to another controller’s frequency. "Contact" means switch and call them; "monitor" means switch and just listen until they call.',
  },
  {
    id: 'roger',
    term: 'Roger',
    category: 'Radio',
    patterns: [/\broger\b/],
    text: 'I received all of your last message. It is not a yes, and not a promise to do anything.',
  },
  {
    id: 'wilco',
    term: 'Wilco',
    category: 'Radio',
    patterns: [/\bwilco\b/],
    text: 'Short for "will comply": understood, and I will do it.',
  },
  {
    id: 'affirm',
    term: 'Affirmative / negative',
    category: 'Radio',
    patterns: [/\baffirm(?:ative)?\b/, /\bnegative\b/],
    text: 'Yes and no. Plain "yes" and "no" are short words easily lost in static.',
  },
  {
    id: 'sayAgain',
    term: 'Say again',
    category: 'Radio',
    patterns: [/\bsay\s+again\b/],
    text: 'Please repeat that. Radio phraseology avoids "repeat", which means something else in military use.',
  },
  {
    id: 'standby',
    term: 'Standby',
    category: 'Radio',
    patterns: [/\bstand\s*-?\s*by\b/],
    text: 'Wait, I will call you back. It is neither an approval nor a refusal.',
  },
  {
    id: 'unable',
    term: 'Unable',
    category: 'Radio',
    patterns: [/\bunable\b/],
    text: 'I can’t do that instruction. Pilots say it when an instruction isn’t safe or possible for them.',
  },
  {
    id: 'expedite',
    term: 'Expedite',
    category: 'Radio',
    patterns: [/\bexpedite\b/],
    text: 'Do it promptly: cross the runway, climb or descend as quickly as is practical.',
  },
  {
    id: 'readback',
    term: 'Read back',
    category: 'Radio',
    patterns: [/\bread\s*-?\s*back\b/, /\breadback\b/],
    text: 'Repeating an instruction back so the controller can check it was heard right. Required for runway, altitude, heading and hold-short instructions.',
  },
  {
    id: 'radarContact',
    term: 'Radar contact',
    category: 'Radio',
    patterns: [/\bradar\s+contact\b/],
    text: 'The controller can see the aircraft on radar and knows which blip it is.',
  },
  {
    id: 'traffic',
    term: 'Traffic, 2 o’clock',
    category: 'Radio',
    patterns: [/\b(?:1[0-2]|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*o'?\s*clock\b/],
    text: 'Where another aircraft is, as on a clock face around the nose: 12 o’clock is straight ahead, 3 o’clock off the right wing, 9 o’clock off the left.',
    diagram: 'clock',
  },
  {
    id: 'inSight',
    term: 'In sight / looking',
    category: 'Radio',
    patterns: [/\b(?:traffic|field|airport|runway)\s+in\s+sight\b/, /\bin\s+sight\b/],
    text: 'The pilot can see it (the traffic, the airport). "Looking" means not yet.',
  },
  {
    id: 'visualSeparation',
    term: 'Visual separation',
    category: 'Radio',
    patterns: [/\b(?:maintain\s+)?visual\s+separation\b/],
    text: 'The pilot keeps the other aircraft in sight and stays clear of it themselves, so the controller doesn’t have to keep the usual radar distance.',
  },
  {
    id: 'sequence',
    term: 'Number two',
    category: 'Radio',
    patterns: [/\bnumber\s+(?:one|two|three|four|five|[1-9])\b/],
    text: 'Place in the landing or departure order: "number two" follows one other aircraft.',
  },
  {
    id: 'zulu',
    term: 'Zulu time',
    category: 'Radio',
    patterns: [/\bzulu\b/, /\b\d{4}Z\b/],
    text: 'UTC, the one time zone all aviation uses, so a 1400Z departure means the same moment everywhere.',
  },

  // ---- Emergencies ----------------------------------------------------------
  {
    id: 'mayday',
    term: 'Mayday',
    category: 'Emergency',
    patterns: [/\bmayday\b/],
    text: 'The distress call: the aircraft is in serious and immediate danger and needs help now. Said three times; everyone else keeps the frequency clear.',
  },
  {
    id: 'panpan',
    term: 'Pan-pan',
    category: 'Emergency',
    patterns: [/\bpan[\s-]?pan\b/],
    text: 'The urgency call: a serious problem that isn’t immediately life-threatening, such as a sick passenger or a technical fault. One step below mayday.',
  },
  {
    id: 'emergencySquawk',
    term: '7500 / 7600 / 7700',
    category: 'Emergency',
    patterns: [/\b7[567]00\b/],
    text: 'The emergency transponder codes: 7500 unlawful interference (hijack), 7600 radio failure, 7700 general emergency. Setting one alerts every controller whose radar sees the aircraft.',
    detail: (m) => (SQUAWK_MEANING[m.trim()] ? `${m.trim()} means ${SQUAWK_MEANING[m.trim()]}.` : null),
  },
  {
    id: 'souls',
    term: 'Souls on board',
    category: 'Emergency',
    patterns: [/\bsouls\s+on\s+board\b/],
    text: 'The number of people on the aircraft, crew included. Controllers ask for it, with the fuel remaining, when an emergency is declared.',
  },
  {
    id: 'rejected',
    term: 'Rejected takeoff',
    category: 'Emergency',
    patterns: [/\breject(?:ed|ing)?\s+(?:the\s+)?take\s*-?\s*off\b/, /\babort(?:ed|ing)?\s+(?:the\s+)?take\s*-?\s*off\b/],
    text: 'Stopping a takeoff that is already rolling, for example after an engine warning or something on the runway. Crews practise it and decide by a set speed (V1) whether to stop or go.',
  },

  // ---- Weather ----------------------------------------------------------------
  {
    id: 'atis',
    term: 'ATIS / Information',
    category: 'Weather',
    patterns: [/\bATIS\b/i, /\binformation\s+(?:alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliett?|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|x-?ray|yankee|zulu)\b/],
    text: 'A recorded broadcast with the weather, runways in use and notices, re-recorded at least hourly and tagged with a letter ("Information Bravo"). Pilots say "with Bravo" to show they have heard the latest one.',
  },
  {
    id: 'metar',
    term: 'METAR',
    category: 'Weather',
    patterns: [/\bMETAR\b/i],
    text: 'The routine weather observation, issued every hour (and in between when things change): wind, visibility, weather, cloud, temperature and pressure, in a compact code.',
  },
  {
    id: 'taf',
    term: 'TAF',
    category: 'Weather',
    patterns: [/\bTAF\b/],
    caseSensitive: true,
    text: 'Terminal Aerodrome Forecast: the airport’s forecast for the next 24 to 30 hours. FM means "from", BECMG "becoming", TEMPO "temporarily", PROB30 "30% chance".',
  },
  {
    id: 'ceiling',
    term: 'Ceiling',
    category: 'Weather',
    patterns: [/\bceiling\b/],
    text: 'The height of the lowest cloud layer covering more than half the sky (broken or overcast). With a low ceiling, aircraft land on instruments.',
  },
  {
    id: 'cover',
    term: 'Few / scattered / broken / overcast',
    category: 'Weather',
    patterns: [/\b(?:FEW|SCT|BKN|OVC)\d{3}\b/, /\b(?:scattered|broken|overcast)\b/],
    text: 'How much of the sky a cloud layer covers, in eighths: few 1–2, scattered 3–4, broken 5–7, overcast all 8. In a report the three digits are the base in hundreds of feet (BKN012 = broken at 1,200 ft).',
    detail: (m) => {
      const n = /(\d{3})$/.exec(m)?.[1]
      return n ? `This layer’s base is ${(Number(n) * 100).toLocaleString('en-US')} ft above the airport.` : null
    },
  },
  {
    id: 'categories',
    term: 'VFR / IFR',
    category: 'Weather',
    patterns: [/\b(?:L?IFR|M?VFR)\b/],
    caseSensitive: true,
    text: 'Visual or instrument flight rules. As weather categories: VFR is clear enough to fly by sight, MVFR marginal, IFR needs instruments (ceiling under 1,000 ft or visibility under 3 miles), LIFR is very low cloud or fog.',
  },
  {
    id: 'crosswind',
    term: 'Crosswind',
    category: 'Weather',
    patterns: [/\bcross\s*-?\s*winds?\b/],
    text: 'Wind blowing across the runway instead of along it. Pilots point the nose partly into it to track straight, and each type has a demonstrated limit, often 30–40 kt for airliners.',
    diagram: 'crosswind',
  },
  {
    id: 'gusts',
    term: 'Gusting',
    category: 'Weather',
    patterns: [/\bgust(?:s|ing)?\b/, /\b\d{3}\d{2,3}G\d{2,3}KT\b/],
    text: 'Wind speed jumping around: "20 gusting 32" is 20 knots with peaks of 32. Pilots add part of the gust to their approach speed.',
  },
  {
    id: 'windshear',
    term: 'Wind shear',
    category: 'Weather',
    patterns: [/\bwind\s*-?\s*shear\b/],
    text: 'A sudden change in wind speed or direction over a short distance. Dangerous close to the ground; the standard response is to go around.',
  },
  {
    id: 'rvr',
    term: 'RVR',
    category: 'Weather',
    patterns: [/\bRVR\b/i, /\brunway\s+visual\s+range\b/],
    text: 'Runway Visual Range: how far along the runway a pilot can see its lights, measured by instruments. In fog it decides whether takeoffs and landings can go ahead.',
  },
  {
    id: 'cavok',
    term: 'CAVOK',
    category: 'Weather',
    patterns: [/\bCAVOK\b/i],
    text: 'Ceiling and visibility OK: 10 km or more, no cloud below 5,000 ft, no cumulonimbus and no significant weather.',
  },
  {
    id: 'dewpoint',
    term: 'Dew point',
    category: 'Weather',
    patterns: [/\bdew\s*-?\s*point\b/],
    text: 'The temperature at which the air would be saturated. When the temperature falls close to it, expect mist, fog or low cloud.',
  },
  {
    id: 'densityAltitude',
    term: 'Density altitude',
    category: 'Weather',
    patterns: [/\bdensity\s+altitude\b/],
    text: 'How high the airport "feels" to wings and engines. Hot, high, humid air is thin, so takeoff runs are longer and climbs slower.',
  },
  {
    id: 'braking',
    term: 'Braking action',
    category: 'Weather',
    patterns: [/\bbraking\s+action\b/],
    text: 'How well aircraft are stopping on a wet, snowy or icy runway, reported as good, good to medium, medium, medium to poor, poor or nil.',
  },
  {
    id: 'notam',
    term: 'NOTAM',
    category: 'Weather',
    patterns: [/\bNOTAMS?\b/i],
    text: 'Notice to Air Missions (formerly Notice to Airmen): an official notice of a temporary change, such as a closed runway or taxiway or an unlit obstacle.',
  },
  {
    id: 'knots',
    term: 'Knots',
    category: 'Weather',
    patterns: [/\bknots?\b/],
    text: 'Nautical miles per hour, used for airspeed and wind. 1 knot is about 1.15 mph or 1.85 km/h.',
  },

  // ---- Aircraft and callsigns -------------------------------------------------
  {
    id: 'heavy',
    term: 'Heavy',
    category: 'Aircraft',
    patterns: [/\bheavy\b(?!\s+(?:rain|snow|drizzle|showers?|precipitation|thunderstorms?|fog|mist|traffic|hail))/],
    text: 'Added to the callsign of a big aircraft (able to take off at 300,000 lb / 136 t or more) to warn others of its strong wake. Controllers leave extra space behind it.',
  },
  {
    id: 'super',
    term: 'Super',
    category: 'Aircraft',
    patterns: [/\bsuper\b/],
    text: 'Callsign suffix for the Airbus A380, whose wake is stronger still than a heavy’s, so the spacing behind it is the largest.',
  },
  {
    id: 'wake',
    term: 'Wake turbulence',
    category: 'Aircraft',
    patterns: [/\bwake\s+turbulence\b/, /\bwake\b/],
    text: 'Spinning vortices trailing from every aircraft’s wingtips, strongest behind heavy, slow aircraft. They sink and drift with the wind, which is why following aircraft are spaced out.',
  },
  {
    id: 'runway',
    term: 'Runway numbers',
    category: 'Ground',
    patterns: [/\brunway\s+\d{1,2}\s*(?:[LRC]\b|left|right|cent(?:er|re)\b)?/, /\bRWY\s?\d{1,2}[LRC]?\b/i],
    text: 'A runway is named after the direction it points, in tens of degrees (magnetic): runway 31 points about 310°. Parallel runways add L, C or R as seen when lined up. Each end has its own number, 18 apart.',
    diagram: 'runway',
    detail: runwayDetail,
  },
]

export const GLOSSARY_BY_ID: Record<string, GlossaryEntry> = Object.fromEntries(GLOSSARY.map((e) => [e.id, e]))
