/**
 * The small sparkle that marks text an AI wrote, as on the flight card's
 * "Now" line, so people can always tell it from the app's own words.
 */
import { Sparkles } from 'lucide-react'

export function AiMark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 align-[-1px] text-[#C9BCFF] ${className}`} title="Written by AI">
      <Sparkles aria-hidden className="size-3" strokeWidth={2.25} />
      <span className="sr-only">Written by AI: </span>
    </span>
  )
}
