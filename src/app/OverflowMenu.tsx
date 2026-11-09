import { FileText, Play, Radio, X } from 'lucide-react'
import { getClip } from '../api/client'
import { usePlayhead } from '../playback/playheadStore'

const DEMO = 'ord-tower-demo'

export function OverflowMenu() {
  const open = usePlayhead((s) => s.menuOpen)
  const setMenuOpen = usePlayhead((s) => s.setMenuOpen)
  const enterPlayback = usePlayhead((s) => s.enterPlayback)
  const exitPlayback = usePlayhead((s) => s.exitPlayback)
  const setTranscriptsOpen = usePlayhead((s) => s.setTranscriptsOpen)
  const setClip = usePlayhead((s) => s.setClip)
  const setToast = usePlayhead((s) => s.setToast)
  const mode = usePlayhead((s) => s.mode)

  if (!open) return null

  async function startDemo() {
    try {
      const clip = await getClip(DEMO)
      setClip(clip)
      enterPlayback(clip)
      setMenuOpen(false)
    } catch {
      setToast('Could not load demo clip')
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/50 p-3 pb-[max(1rem,var(--safe-bottom))]">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-[#151a24] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Radio className="size-4 text-atc-yellow" />
            Controls
          </div>
          <button
            type="button"
            aria-label="Close menu"
            className="rounded-full bg-white/10 p-2"
            onClick={() => setMenuOpen(false)}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col p-2">
          <button
            type="button"
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium hover:bg-white/5"
            onClick={() => void startDemo()}
          >
            <Play className="size-4 text-atc-yellow" />
            {mode === 'playback' ? 'Restart ORD demo playback' : 'Enter playback (ORD demo)'}
          </button>
          <button
            type="button"
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium hover:bg-white/5"
            onClick={() => {
              setTranscriptsOpen(true)
              setMenuOpen(false)
            }}
          >
            <FileText className="size-4 text-atc-yellow" />
            Transcripts
          </button>
          {mode === 'playback' && (
            <button
              type="button"
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium hover:bg-white/5"
              onClick={() => {
                exitPlayback()
                setMenuOpen(false)
              }}
            >
              <Radio className="size-4 text-atc-yellow" />
              Return to live
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
