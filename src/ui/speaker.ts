/**
 * One colour per side of a radio exchange, used everywhere the app shows who
 * is talking: the pulsing halo and ping around the aircraft, and the ripple
 * that travels between the tower and the aircraft.
 *
 * The owner's rule: ATC talking to an aircraft pulses purple (the flight card
 * family); the aircraft talking to ATC pulses blue. A call nobody could
 * attribute is treated as ATC, the common case for a call that names a flight.
 */
export type RadioSpeaker = 'controller' | 'pilot' | null | undefined

export type SpeakerColors = {
  /** Fill for discs and the body of the ripple. */
  base: string
  /** Lighter edge for strokes that must read on the dark map. */
  light: string
}

export const ATC_COLORS: SpeakerColors = { base: '#7C5CFC', light: '#A994FF' }
export const PILOT_COLORS: SpeakerColors = { base: '#3B9BFF', light: '#8CC4FF' }

/** The colours for whoever has the microphone. */
export function speakerColors(speaker: RadioSpeaker): SpeakerColors {
  return speaker === 'pilot' ? PILOT_COLORS : ATC_COLORS
}

/**
 * Which way a call travels on the map: from the tower out to the aircraft
 * when ATC speaks, from the aircraft back to the tower when the pilot does.
 */
export function speakerDirection(speaker: RadioSpeaker): 'to-aircraft' | 'to-tower' {
  return speaker === 'pilot' ? 'to-tower' : 'to-aircraft'
}
