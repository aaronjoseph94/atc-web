/**
 * One colour per side of a radio exchange, used everywhere the app shows who
 * is talking: the soft waves that pulse out from the aircraft on the map, and
 * the speaker labels in the transcript.
 *
 * The owner's rule: the tower talking to an aircraft pulses pink; the aircraft
 * talking to the tower pulses blue. Both are mellow tints, chosen to sit
 * beside the violet selection and the navy map without shouting. A call
 * nobody could attribute is treated as ATC, the common case for a call that
 * names a flight.
 */
export type RadioSpeaker = 'controller' | 'pilot' | null | undefined

export type SpeakerColors = {
  /** The waves and glow around the aircraft. */
  base: string
  /** A lighter tint for text and thin marks that must read on the dark map and panels. */
  light: string
}

export const ATC_COLORS: SpeakerColors = { base: '#F178B6', light: '#F8ACD2' }
export const PILOT_COLORS: SpeakerColors = { base: '#60A5FA', light: '#9CC7FD' }

/** The colours for whoever has the microphone. */
export function speakerColors(speaker: RadioSpeaker): SpeakerColors {
  return speaker === 'pilot' ? PILOT_COLORS : ATC_COLORS
}
