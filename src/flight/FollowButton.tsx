import { Check, Crosshair } from 'lucide-react'
import { usePlayhead } from '../playback/playheadStore'

/** Lock / unlock the camera on the aircraft. Reads "Following" while locked, "Re-center" once the map has been moved. */
export function FollowButton({ tone, compact = false }: { tone: 'card' | 'dark'; compact?: boolean }) {
  const following = usePlayhead((s) => s.following)
  const setFollowing = usePlayhead((s) => s.setFollowing)
  const base = 'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition active:scale-95'
  // Where room is short (the full view's top bar on a phone, or beside the side panel's back button)
  // the button keeps only its icon; the word stays as its accessible name.
  const word = compact ? 'sr-only' : tone === 'dark' ? 'max-sm:sr-only' : ''
  return following ? (
    <button type="button" data-no-drag aria-pressed title="Following" className={`${base} ${tone === 'card' ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-white/10 text-white hover:bg-white/20'}`} onClick={() => setFollowing(false)}>
      <Check className="size-3.5" strokeWidth={3} /> <span className={word}>Following</span>
    </button>
  ) : (
    <button type="button" data-no-drag title="Re-center" className={`${base} bg-white text-atc-card hover:bg-white/90`} onClick={() => setFollowing(true)}>
      <Crosshair className="size-3.5" strokeWidth={2.5} /> <span className={word}>Re-center</span>
    </button>
  )
}
