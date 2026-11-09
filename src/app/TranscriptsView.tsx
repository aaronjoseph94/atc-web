/** Scrollable list of transcript cues; tapping a cue seeks playback to it. */
import { getClip } from '../api/client'
import { usePlayhead } from '../playback/playheadStore'
import { FullPanel } from '../ui/Panel'

const DEMO = 'ord-tower-demo'

export function TranscriptsView() {
  const open = usePlayhead((s) => s.panel === 'transcripts')
  const clip = usePlayhead((s) => s.clip)
  const tMs = usePlayhead((s) => s.tMs)
  const mode = usePlayhead((s) => s.mode)
  const setPanel = usePlayhead((s) => s.setPanel)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const enterPlayback = usePlayhead((s) => s.enterPlayback)
  const setToast = usePlayhead((s) => s.setToast)

  if (!open) return null

  // Seeking from live mode first enters playback so audio + map follow.
  const jumpTo = async (startMs: number) => {
    if (mode !== 'playback') {
      try {
        enterPlayback(clip ?? (await getClip(DEMO)))
      } catch {
        setToast('Could not load demo clip')
        return
      }
    }
    setTMs(startMs)
    setPlaying(true)
    setPanel(null)
  }

  const cues = clip?.cues ?? []

  return (
    <FullPanel title={clip ? `Transcripts · ${clip.title}` : 'Transcripts'} onClose={() => setPanel(null)}>
      {cues.length === 0 ? (
        <p className="py-6 text-center text-sm text-atc-muted">No transcript loaded.</p>
      ) : (
        <ul className="space-y-2">
          {cues.map((c) => {
            const active = mode === 'playback' && tMs >= c.startMs && tMs < c.endMs
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={active || undefined}
                  className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                    active ? 'bg-atc-purple/25 ring-1 ring-atc-purple' : 'bg-white/[0.04] hover:bg-white/[0.08]'
                  }`}
                  onClick={() => void jumpTo(c.startMs)}
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-white/55">
                    <span className="tabular-nums">{formatMs(c.startMs)}</span>
                    {c.speaker && <span className="rounded bg-white/10 px-1.5 py-px">{c.speaker}</span>}
                    {c.callsign && <span className="font-semibold text-atc-yellow">{c.callsign}</span>}
                  </div>
                  <div className="text-sm leading-snug">{c.text}</div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </FullPanel>
  )
}

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}
