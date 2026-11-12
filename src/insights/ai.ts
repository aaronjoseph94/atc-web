/**
 * How the insight features ask the AI, and only when it can answer: one
 * status check (shared with Settings), then each task through TanStack Query
 * so identical asks are answered from memory, never repeated per render or per
 * poll. Anything that fails just leaves the built-in text in place.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { aiReadyNow, askAi, useAiReady } from '../ai/client'

// Ready means: switched on here, set up on the server, and under the site's daily cap.
export { aiReadyNow, useAiReady }

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
