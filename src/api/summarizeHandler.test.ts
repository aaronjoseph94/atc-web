import { describe, expect, it } from 'vitest'
import { aiStatus, parseSummarizeRequest, summarize } from './summarizeHandler'

describe('parseSummarizeRequest', () => {
  it('rejects an empty body', () => {
    expect(() => parseSummarizeRequest({})).toThrow(/callsign/)
  })

  it('keeps only the latest calls', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ speaker: 'Tower', text: `call ${i}` }))
    const req = parseSummarizeRequest({ callsign: 'UAL1', transmissions: many })
    expect(req.transmissions.length).toBeLessThanOrEqual(8)
    expect(req.transmissions.at(-1)?.text).toBe('call 19')
  })
})

describe('summarize', () => {
  it('uses the phrasebook when no key is set', async () => {
    const res = await summarize(
      {
        callsign: 'UAL2099',
        transmissions: [{ speaker: 'Tower', text: 'cleared to land runway two eight right' }],
      },
      {},
    )
    expect(res.source).toBe('rules')
    expect(res.summary).toContain('28R')
    expect(aiStatus({}).configured).toBe(false)
  })

  it('reports a configured provider without exposing the key', () => {
    const s = aiStatus({ AI_API_KEY: 'sk-test', AI_BASE_URL: 'https://api.anthropic.com', AI_MODEL: 'claude-sonnet-5-5' })
    expect(s).toEqual({ configured: true, provider: 'anthropic', model: 'claude-sonnet-5-5' })
    expect(JSON.stringify(s)).not.toContain('sk-test')
  })

  it('only runs Haiku or Sonnet, in the form the provider expects', () => {
    expect(aiStatus({ AI_API_KEY: 'k', AI_BASE_URL: 'https://api.anthropic.com' }).model).toBe('claude-haiku-5-5')
    expect(aiStatus({ AI_API_KEY: 'k', AI_BASE_URL: 'https://api.anthropic.com', AI_MODEL: 'claude-opus-5-5' }).model).toBe('claude-haiku-5-5')
    expect(aiStatus({ AI_API_KEY: 'k' }).model).toBe('anthropic/claude-haiku-5.5')
    expect(aiStatus({ AI_API_KEY: 'k', AI_MODEL: 'claude-sonnet-5-5' }).model).toBe('anthropic/claude-sonnet-5.5')
    expect(aiStatus({ AI_API_KEY: 'k', AI_MODEL: 'anthropic/claude-opus-5.5' }).model).toBe('anthropic/claude-haiku-5.5')
  })
})
