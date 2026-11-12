import { describe, expect, it } from 'vitest'
import { AI_STORAGE_KEY, scrubStoredAiKeys } from './aiSettings'

/** A stand-in for localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

describe('scrubStoredAiKeys', () => {
  it('deletes keys an earlier version saved, keeping only the on/off choice', () => {
    const old = { state: { provider: 'anthropic', model: 'claude-opus-5-5', anthropicKey: 'sk-ant-secret', openrouterKey: 'sk-or-secret', enabled: false }, version: 0 }
    const s = fakeStorage({ [AI_STORAGE_KEY]: JSON.stringify(old), 'atc-web.settings': '{"keep":"me"}' })
    expect(scrubStoredAiKeys(s)).toBe(true)
    const after = s.data.get(AI_STORAGE_KEY)!
    expect(after).not.toContain('sk-ant-secret')
    expect(after).not.toContain('sk-or-secret')
    expect(JSON.parse(after)).toEqual({ state: { enabled: false }, version: 2 })
    // Nothing else in the browser's storage is touched.
    expect(s.data.get('atc-web.settings')).toBe('{"keep":"me"}')
  })

  it('keeps AI on for someone who had it on', () => {
    const s = fakeStorage({ [AI_STORAGE_KEY]: JSON.stringify({ state: { anthropicKey: 'sk-ant-x', enabled: true }, version: 0 }) })
    scrubStoredAiKeys(s)
    expect(JSON.parse(s.data.get(AI_STORAGE_KEY)!).state).toEqual({ enabled: true })
  })

  it('leaves clean storage alone', () => {
    const clean = JSON.stringify({ state: { enabled: true }, version: 2 })
    const s = fakeStorage({ [AI_STORAGE_KEY]: clean })
    expect(scrubStoredAiKeys(s)).toBe(false)
    expect(s.data.get(AI_STORAGE_KEY)).toBe(clean)
    expect(scrubStoredAiKeys(fakeStorage())).toBe(false)
    expect(scrubStoredAiKeys(null)).toBe(false)
  })

  it('removes an entry it cannot read rather than leave a key behind', () => {
    const s = fakeStorage({ [AI_STORAGE_KEY]: '{"state":{"anthropicKey":"sk-ant-broken' })
    expect(scrubStoredAiKeys(s)).toBe(true)
    expect(s.data.has(AI_STORAGE_KEY)).toBe(false)
  })
})
