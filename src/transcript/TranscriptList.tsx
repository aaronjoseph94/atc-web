import { X } from 'lucide-react'
import { usePlayhead } from '../playback/playheadStore'

export function TranscriptList() {
  const open = usePlayhead((s) => s.transcriptsOpen)
  const clip = usePlayhead((s) => s.clip)
  const tMs = usePlayhead((s) => s.tMs)
  const setTranscriptsOpen = usePlayhead((s) => s.setTranscriptsOpen)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)

  if (!open) return null

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-atc-bg/95 backdrop-blur-md">
      <header className="flex items-center justify-between px-4 pb-2 pt-[max(0.75rem,var(--safe-top))]">
        <h2 className="text-lg font-semibold">Transcripts</h2>
        <button
          type="button"
          aria-label="Close transcripts"
          className="rounded-full bg-white/10 p-2"
          onClick={() => setTranscriptsOpen(false)}
        >
          <X className="size-5" />
        </button>
      </header>
      <ul className="flex-1 space-y-3 overflow-y-auto px-4 pb-8">
        {(clip?.cues ?? []).map((c) => {
          const active = tMs >= c.startMs && tMs < c.endMs
          return (
            <li key={c.id}>
              <button
                type="button"
                className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                  active ? 'bg-atc-purple/30 ring-1 ring-atc-purple' : 'bg-white/5'
                }`}
                onClick={() => {
                  setTMs(c.startMs)
                  setPlaying(true)
                }}
              >
                <div className="mb-1 text-xs text-white/50">
                  {formatMs(c.startMs)}
                  {c.callsign ? ` · ${c.callsign}` : ''}
                </div>
                <div className="text-sm leading-snug">{c.text}</div>
              </button>
            </li>
          )
        })}
        {!clip?.cues?.length && (
          <li className="text-center text-sm text-white/50">No transcript cues loaded.</li>
        )}
      </ul>
    </div>
  )
}

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}
