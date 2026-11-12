/**
 * Which part of Help to open at. The menu's "Map data and credits" entry
 * asks for the credits; Help reads the request when it opens and clears it
 * once it has scrolled there (or closed).
 * A plain module value: nothing renders from it.
 */
import { usePlayhead } from '../playback/playheadStore'

export type HelpSection = 'credits'

/** Id of the credits heading in the Help sheet. */
export const CREDITS_ID = 'help-credits'

let wanted: HelpSection | null = null

/** Open Help scrolled to its credits. */
export function openCredits() {
  wanted = 'credits'
  usePlayhead.getState().setPanel('help')
}

/** The section asked for, if any, left in place. */
export function wantedHelpSection(): HelpSection | null {
  return wanted
}

/** The section asked for, if any, and forget the request. */
export function takeHelpSection(): HelpSection | null {
  const s = wanted
  wanted = null
  return s
}
