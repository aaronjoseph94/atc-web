/**
 * Runs the spotter on the live traffic: every few seconds (not per frame)
 * it scores aircraft it hasn't judged yet, keeps the Spotted list, puts stars
 * on rare aircraft's tags and, now and then, says so in a toast.
 *
 * Mounted once by the app shell. Does nothing in replays.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { getAirport } from '../api/airports'
import { liveBuffer } from '../live/session'
import { usePlayhead } from '../playback/playheadStore'
import { setStarred } from './marks'
import { useSpotSettings } from './spotSettings'
import { Spotter, ToastGate, toastText, type Spot } from './spotter'
import { noteUnknowns, useUnknowns } from './unknowns'

export const useSpotted = create<{ airport: string; spots: Spot[] }>(() => ({ airport: '', spots: [] }))

const SCAN_MS = 4000
/** A rare aircraft keeps its star while it was seen this recently. */
const STAR_MS = 90_000

export function useSpotter() {
  useEffect(() => {
    let spotter: Spotter | null = null
    let noted = new Set<string>()
    const gate = new ToastGate()

    const restar = () => {
      const spots = spotter?.spots ?? []
      const now = Date.now()
      setStarred(useSpotSettings.getState().stars ? spots.filter((s) => s.rare && now - s.lastAt < STAR_MS).map((s) => s.icao24) : [])
    }

    const tick = () => {
      const st = usePlayhead.getState()
      if (st.mode !== 'live') return
      if (!spotter || spotter.airport !== st.airportIcao) {
        spotter = new Spotter(st.airportIcao, getAirport(st.airportIcao).elevationFt)
        noted = new Set()
        useSpotted.setState({ airport: st.airportIcao, spots: [] })
      }
      const now = Date.now()
      const list = liveBuffer.sample()

      const fresh = list.filter((a) => !noted.has(a.icao24) && a.type)
      if (fresh.length) {
        for (const a of fresh) noted.add(a.icao24)
        const u = useUnknowns.getState()
        const next = noteUnknowns(u, fresh, now)
        if (next !== u) useUnknowns.setState({ types: next.types, prefixes: next.prefixes })
      }

      const { added, changed } = spotter.scan(list, now)
      if (changed) useSpotted.setState({ spots: [...spotter.spots] })
      restar()

      // One toast for the rarest newcomer, if pacing allows and nothing else is being said.
      const top = added.find((s) => s.rare)
      if (top && useSpotSettings.getState().toasts && !st.toast && document.visibilityState === 'visible' && gate.allow(top.icao24, now)) {
        st.setToast({ message: toastText(top), action: { label: 'Show', run: () => usePlayhead.getState().select(top.icao24) } })
      }
    }

    // Give the first poll a moment to land before the first look.
    const first = window.setTimeout(tick, 2500)
    const id = window.setInterval(tick, SCAN_MS)
    const unsub = useSpotSettings.subscribe(restar)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
      unsub()
      setStarred([])
    }
  }, [])
}
