/**
 * Keeps the live radio in step with the rest of the app, and the controls
 * the UI calls.
 *
 * - Changing channel or airport while listening retunes (or says there is
 *   no feed for the new channel).
 * - A replay silences the radio; leaving the replay brings it back.
 * - Transmissions are transcribed while the radio plays.
 *
 * `tuneRadio` and `toggleRadio` start audio, so call them straight from a
 * click or key handler: that is what lets the browser play sound.
 */
import { useEffect } from 'react'
import { getAirport, resolveStation } from '../../api/airports'
import { feedFor } from '../../api/radioFeeds'
import type { Station } from '../../api/types'
import { usePlayhead } from '../../playback/playheadStore'
import { startRadio, stopRadio } from './player'
import { useRadio } from './radioStore'
import { clearQueue, releaseFocus, startTranscriber } from './transcriber'

/** Listen to a channel (from a tap). Channels no feed carries say so and wait for a better choice. */
export function tuneRadio(station: Station | undefined) {
  const feed = feedFor(station)
  if (feed) startRadio(feed)
  else stopRadio(true, 'nofeed')
}

/** The station bar's play/pause button. */
export function toggleRadio() {
  const { on, status } = useRadio.getState()
  if (on && status !== 'off' && status !== 'nofeed' && status !== 'blocked') {
    stopRadio()
    return
  }
  const s = usePlayhead.getState()
  tuneRadio(resolveStation(getAirport(s.airportIcao), s.stationId))
}

/** The channel being followed right now. */
function currentStation() {
  const s = usePlayhead.getState()
  return resolveStation(getAirport(s.airportIcao), s.stationId)
}

export function useLiveRadio() {
  useEffect(() => {
    const stopTranscriber = startTranscriber()
    const unsubscribe = usePlayhead.subscribe((s, prev) => {
      const radio = useRadio.getState()
      if (s.mode !== prev.mode) {
        if (s.mode === 'playback') {
          // A replay has its own audio; keep the wish to listen for afterwards.
          releaseFocus()
          clearQueue()
          useRadio.getState().patch({ caption: null })
          if (radio.on) stopRadio(true)
        } else if (radio.on) {
          tuneRadio(currentStation())
        }
        return
      }
      if (s.mode !== 'live') return
      if (s.airportIcao !== prev.airportIcao || s.stationId !== prev.stationId) {
        releaseFocus()
        clearQueue()
        useRadio.getState().patch({ caption: null })
        if (radio.on) tuneRadio(currentStation())
      }
    })
    return () => {
      unsubscribe()
      stopTranscriber()
    }
  }, [])
}
