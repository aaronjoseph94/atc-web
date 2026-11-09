/** The "⋯" menu: playback, transcripts, settings, return to live. */
import { FileText, Play, Radio, Settings, type LucideIcon } from 'lucide-react'
import { getClip } from '../api/client'
import { usePlayhead } from '../playback/playheadStore'
import { Sheet } from '../ui/Panel'

const DEMO = 'ord-tower-demo'

export function OverflowMenu() {
  const open = usePlayhead((s) => s.panel === 'menu')
  const mode = usePlayhead((s) => s.mode)
  const setPanel = usePlayhead((s) => s.setPanel)
  const enterPlayback = usePlayhead((s) => s.enterPlayback)
  const exitPlayback = usePlayhead((s) => s.exitPlayback)
  const setClip = usePlayhead((s) => s.setClip)
  const setToast = usePlayhead((s) => s.setToast)

  if (!open) return null

  async function startDemo() {
    try {
      const clip = await getClip(DEMO)
      setClip(clip)
      enterPlayback(clip)
    } catch {
      setToast('Could not load demo clip')
    }
  }

  return (
    <Sheet title="Menu" onClose={() => setPanel(null)}>
      <div className="flex flex-col gap-1 pb-1">
        <Item
          icon={Play}
          label={mode === 'playback' ? 'Restart ORD demo playback' : 'Enter playback (ORD demo)'}
          hint="Recorded tower audio with synced transcript and aircraft tracks"
          onClick={() => void startDemo()}
        />
        {mode === 'playback' && (
          <Item icon={Radio} label="Return to live" hint="Back to real-time traffic" onClick={exitPlayback} />
        )}
        <Item icon={FileText} label="Transcripts" hint="Browse and jump to cues" onClick={() => setPanel('transcripts')} />
        <Item icon={Settings} label="Settings" hint="Units, labels, polling, data feed status" onClick={() => setPanel('settings')} />
      </div>
    </Sheet>
  )
}

function Item({ icon: Icon, label, hint, onClick }: { icon: LucideIcon; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/5 active:bg-white/10"
      onClick={onClick}
    >
      <span className="rounded-lg bg-atc-yellow/15 p-2 text-atc-yellow">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-atc-muted">{hint}</span>
      </span>
    </button>
  )
}
