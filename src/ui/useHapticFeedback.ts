/**
 * App-wide haptic moments that don't belong to one control: picking an
 * aircraft, and the selected flight being called on the radio. (The dial and
 * the sheets tick from their own handlers.)
 */
import { useEffect } from 'react'
import { useRadio, type Transmission } from '../live/radio/radioStore'
import { usePlayhead } from '../playback/playheadStore'
import { haptic } from './haptics'

/** Does this call name (or come from) the given aircraft? */
export function callNames(call: Pick<Transmission, 'icao24' | 'callsigns'>, icao24: string): boolean {
  return call.icao24 === icao24 || call.callsigns.some((c) => c.icao24 === icao24)
}

export function useHapticFeedback() {
  useEffect(() => {
    // Selecting runs inside the tap's handler, which is what lets iOS play the tick.
    const offSelect = usePlayhead.subscribe((s, prev) => {
      if (s.selectedIcao && s.selectedIcao !== prev.selectedIcao) haptic('select')
    })
    const offRadio = useRadio.subscribe((r, prev) => {
      const call = r.caption
      if (!call || call.id === prev.caption?.id) return
      const selected = usePlayhead.getState().selectedIcao
      if (selected && callNames(call, selected)) haptic('call')
    })
    return () => {
      offSelect()
      offRadio()
    }
  }, [])
}
