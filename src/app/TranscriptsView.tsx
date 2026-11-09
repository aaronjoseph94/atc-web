import { X } from 'lucide-react'
import { usePlayhead } from '../playback/playheadStore'

export function TranscriptsView() {
  const open = usePlayhead((s) => s.transcriptsOpen)
  const setTranscriptsOpen = usePlayhead((s) => s.setTranscriptsOpen)
  const clip = usePlayhead((s) => s.clip)
  const tMs = usePlayhead((s) => s.tMs)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const mode = usePlayhead((s) => s.mode)

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
      {mode === 'live' && !clip?.cues?.length ? (
        <p className="px-4 text-sm text-white/50">Enter ORD demo Playback to view cues.</p>
      ) : (
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
        </ul>
      )}
    </div>
  )
}

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}
