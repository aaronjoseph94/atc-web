/**
 * The row of thin bars along the bottom of the station bar (and the flight
 * card).
 *
 * It is the real spectrum of whatever is playing, read from an analyser
 * every frame: the replayed scene's audio, or the live radio stream. With no
 * audio the bars rest at their minimum height; nothing is faked.
 */
import { useEffect, useRef } from 'react'
import { analysers, type AnalyserSource } from '../live/radio/audioGraph'

const BARS = 72

export function Waveform({ active, color = 'rgba(40,26,0,0.78)', source = 'replay' }: { active: boolean; color?: string; source?: AnalyserSource }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const levels = new Float32Array(BARS)
    let bins: Uint8Array<ArrayBuffer> | null = null
    let raf = 0
    // The bars as last drawn were all at rest (and at this size): nothing to redraw until they move.
    let restingAt = ''

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = canvas.clientWidth
      const h = canvas.clientHeight

      // The analyser may appear after this effect ran (it is created on the first play).
      const analyser = active ? analysers[source] : null
      if (analyser) {
        if (!bins || bins.length !== analyser.frequencyBinCount) bins = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(bins)
      }
      let moving = false
      for (let i = 0; i < BARS; i++) {
        // Radio speech lives in the low bins; mirror them so the shape is symmetric.
        const k = Math.abs(i - BARS / 2) / (BARS / 2)
        const bin = bins && analyser ? bins[Math.min(bins.length - 1, Math.round(2 + k * 46))] / 255 : 0
        const target = analyser ? bin ** 1.4 : 0
        // Fast attack, slow release, like a level meter.
        levels[i] += (target - levels[i]) * (target > levels[i] ? 0.55 : 0.12)
        if (levels[i] > 0.01) moving = true
      }
      // Silence between calls is most of the time: the resting row is already on the canvas.
      const size = `${w}x${h}@${dpr}`
      if (!moving && restingAt === size) {
        if (!active) cancelAnimationFrame(raf)
        return
      }
      restingAt = moving ? '' : size
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // Thin vertical bars rising from the bottom edge.
      ctx.fillStyle = color
      const pitch = 4
      const count = Math.floor(w / pitch)
      for (let x = 0; x < count; x++) {
        // Stretch the level curve across however many bars fit.
        const f = (x / Math.max(1, count - 1)) * (BARS - 1)
        const i = Math.floor(f)
        const level = levels[i] + (levels[Math.min(BARS - 1, i + 1)] - levels[i]) * (f - i)
        const bar = Math.max(2, level * (h - 1))
        ctx.fillRect(x * pitch, h - bar, 2, bar)
      }
      // Nothing left to animate and nothing to wait for: stop until the next change.
      if (!active && !moving) cancelAnimationFrame(raf)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [active, color, source])

  return <canvas ref={ref} className="block h-5 w-full" aria-hidden />
}
