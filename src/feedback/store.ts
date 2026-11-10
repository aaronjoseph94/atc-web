/**
 * Whether the feedback sheet is open, and what it captured when it opened
 * (the map picture and the app context), so the report describes the moment
 * the person decided to write, not the moment they pressed Send.
 */
import { create } from 'zustand'
import type { FeedbackContext } from '../api/ai/tasks/triageFeedback'
import type { FeedbackResult } from '../api/feedbackHandler'
import { usePlayhead } from '../playback/playheadStore'
import { captureMap } from './capture'
import { collectContext } from './context'

type FeedbackState = {
  open: boolean
  context: FeedbackContext | null
  screenshot: string | null
}

export const useFeedback = create<FeedbackState>(() => ({ open: false, context: null, screenshot: null }))

/** Close whatever panel is up and open the feedback sheet. */
export function openFeedback() {
  const from = usePlayhead.getState().panel
  usePlayhead.getState().setPanel(null)
  useFeedback.setState({ open: true, context: { ...collectContext(), panel: from === 'menu' ? null : from }, screenshot: null })
  void captureMap().then((screenshot) => {
    if (useFeedback.getState().open) useFeedback.setState({ screenshot })
  })
}

export function closeFeedback() {
  useFeedback.setState({ open: false })
}

export type Sent = Extract<FeedbackResult, { ok: true }>

/** Post a report. Sends no AI keys: the server triages with its own, or by rules. */
export async function postFeedback(payload: { text: string; context: unknown; screenshot: string | null }, signal?: AbortSignal): Promise<Sent> {
  const res = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal })
  const body = (await res.json().catch(() => null)) as FeedbackResult | null
  if (!body) throw new Error(res.status === 404 ? 'Feedback isn’t available on this server.' : `Couldn’t send (${res.status}).`)
  if (!body.ok) throw new Error(body.error)
  return body
}
