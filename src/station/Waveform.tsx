/**
 * The row of thin bars along the bottom of the station bar.
 *
 * In playback it is the real spectrum of the audio, read from the analyser
 * every frame. With no audio (live mode, or a silent replay) the bars rest
 * at their minimum height; nothing is faked.
 */
import { useEffect, useRef } from 'react'
import { audioAnalyser } from '../playback/AudioEngine'

const BARS = 72

export function Waveform({ active, color = 'rgba(40,26,0,0.78)' }: { active: boolean; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const levels = new Float32Array(BARS)
    let bins: Uint8Array<ArrayBuffer> | null = null
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const analyser = active ? audioAnalyser.node : null
      if (analyser) {
        bins ??= new Uint8Array(analyser.frequencyBinCount)
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
      // Nothing left to animate: stop until the next change.
      if (!analyser && !moving) cancelAnimationFrame(raf)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [active, color])

  return <canvas ref={ref} className="block h-5 w-full" aria-hidden />
}
