import { afterEach, describe, expect, it, vi } from 'vitest'
import { askAi } from './client'

afterEach(() => vi.unstubAllGlobals())

describe('askAi sharing', () => {
  it('one caller aborting does not cancel the answer for another caller', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fetchMock = vi.fn(async () => {
      await gate
      return new Response(JSON.stringify({ ok: true, result: { a: 1 }, provider: 'anthropic', model: 'm' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctrl = new AbortController()
    const first = askAi('t-share', { x: 1 }, { signal: ctrl.signal })
    const second = askAi('t-share', { x: 1 })
    ctrl.abort()
    await expect(first).rejects.toBeTruthy()
    release()
    await expect(second).resolves.toEqual({ a: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
