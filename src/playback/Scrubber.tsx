import { Pause, Play } from 'lucide-react'
import { usePlayhead } from './playheadStore'

export function Scrubber() {
  const mode = usePlayhead((s) => s.mode)
  const tMs = usePlayhead((s) => s.tMs)
  const clip = usePlayhead((s) => s.clip)
  const playing = usePlayhead((s) => s.playing)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const exitPlayback = usePlayhead((s) => s.exitPlayback)

  if (mode !== 'playback' || !clip) return null

  const dur = clip.durationMs || 1
  const pct = Math.min(100, (tMs / dur) * 100)

  return (
    <div className="absolute inset-x-0 top-[max(0.5rem,var(--safe-top))] z-20 mx-auto flex w-full max-w-lg flex-col gap-2 px-3">
      <div className="flex items-center justify-between rounded-full bg-black/55 px-3 py-2 backdrop-blur-md">
        <span className="text-sm font-semibold">Playback</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
            className="rounded-full bg-white/15 p-2"
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <button
            type="button"
            className="rounded-full bg-atc-yellow px-3 py-1.5 text-xs font-bold text-black"
            onClick={() => exitPlayback()}
          >
            Exit Playback
          </button>
        </div>
      </div>
      <div className="rounded-xl bg-black/50 px-3 py-2 backdrop-blur-md">
        <input
          type="range"
          min={0}
          max={dur}
          value={tMs}
          aria-label="Scrub playback"
          className="w-full accent-atc-yellow"
          onChange={(e) => {
            setTMs(Number(e.target.value))
          }}
        />
        <div className="mt-1 flex justify-between text-[11px] text-white/60">
          <span>{fmt(tMs)}</span>
          <span>{pct.toFixed(0)}%</span>
          <span>{fmt(dur)}</span>
        </div>
      </div>
    </div>
  )
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}
