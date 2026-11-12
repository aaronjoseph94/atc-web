/**
 * One quiet notice when the site's AI allowance for the day is used up, so
 * the "unprocessed" radio calls that follow have an explanation. Shown once
 * a day per tab; every feature falls back on its own, so nothing else is said.
 */
import { usePlayhead } from '../playback/playheadStore'
import { useAiLimit, type AiLimit } from './client'

const SEEN_KEY = 'atc-web.ai-limit-notice'

/** What to say for a limit, or null when it is not worth a notice (a small task's own cap). */
export function limitMessage(limit: AiLimit): string | null {
  if (limit.code === 'daily_cap') return 'AI daily limit reached. Radio calls are shown as heard until tomorrow.'
  if (limit.task === 'radioCleanup') return 'AI limit for radio calls reached. They are shown as heard until tomorrow.'
  return null
}

/** Start watching for the limit. Returns a stop function. */
export function startAiLimitNotice(): () => void {
  return useAiLimit.subscribe((s, prev) => {
    if (!s.limited || prev.limited) return
    const message = limitMessage(s.limited)
    if (!message) return
    const day = new Date().toISOString().slice(0, 10)
    try {
      if (sessionStorage.getItem(SEEN_KEY) === day) return
      sessionStorage.setItem(SEEN_KEY, day)
    } catch {
      // No session storage: the notice may show again after the limit is re-checked, which is still rare.
    }
    usePlayhead.getState().setToast(message)
  })
}
