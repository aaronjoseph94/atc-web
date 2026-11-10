/**
 * How the insight features ask the AI, and only when it can answer: one
 * status check (shared with Settings), then each task through TanStack Query
 * so identical asks are answered from memory, never repeated per render or per
 * poll. Anything that fails just leaves the built-in text in place.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { askAi, getAiRunStatus } from '../ai/client'
import { useAiSettings } from '../ai/aiSettings'

/** True when an AI feature should try: switched on, and a key on this device or the server. */
export function useAiReady(): boolean {
  const s = useAiSettings()
  const local = !!s.anthropicKey.trim() || !!s.openrouterKey.trim()
  // Same key as Settings > AI, so the two share one status request.
  const status = useQuery({
    queryKey: ['ai-run-status', s.provider, s.model, !!s.anthropicKey, !!s.openrouterKey],
    queryFn: getAiRunStatus,
    staleTime: 5 * 60_000,
    retry: 0,
    enabled: s.enabled && !local,
  })
  return s.enabled && (local || !!status.data?.configured)
}

/** The same check outside React (alerts run from store subscriptions). */
export async function aiReadyNow(): Promise<boolean> {
  const s = useAiSettings.getState()
  if (!s.enabled) return false
  if (s.anthropicKey.trim() || s.openrouterKey.trim()) return true
  try {
    return (await getAiRunStatus()).configured
  } catch {
    return false
  }
}

/**
 * Run `task` on `input` when AI is ready and `input` is not null; returns the
 * parsed answer, or null while waiting, on failure, or when the answer is not
 * the expected shape. `parse` validates (the model's answer is untrusted).
 */
export function useAiTask<T>(task: string, input: unknown, parse: (raw: unknown) => T | null, staleMs: number, opts: { keepPrevious?: boolean } = {}): { data: T | null; loading: boolean } {
  const ready = useAiReady()
  const q = useQuery({
    queryKey: ['ai-task', task, input],
    // No abort signal: askAi shares one request between identical asks, and a component that
    // unmounts (or React's dev double-mount) aborting it would fail the others too. Answers are small.
    queryFn: async () => parse(await askAi(task, input)),
    enabled: ready && input != null,
    staleTime: staleMs,
    gcTime: Math.max(staleMs, 5 * 60_000),
    retry: 0,
    refetchOnWindowFocus: false,
    // A briefing being refreshed keeps the old words until the new ones arrive.
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
  })
  return { data: q.data ?? null, loading: ready && input != null && q.isLoading }
}
