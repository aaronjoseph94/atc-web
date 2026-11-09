import { useEffect, useState } from 'react'

/**
 * Keeps a closing element mounted long enough to play its exit animation.
 * Returns whether to render at all, and whether it is on its way out.
 */
export function usePresence(open: boolean, exitMs = 220): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open)
  // Mount synchronously when opening (state adjusted during render, as React recommends).
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open || !mounted) return
    const id = window.setTimeout(() => setMounted(false), exitMs)
    return () => window.clearTimeout(id)
  }, [open, mounted, exitMs])

  return { mounted, closing: mounted && !open }
}
