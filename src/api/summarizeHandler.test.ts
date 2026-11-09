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
    const s = aiStatus({ AI_API_KEY: 'sk-test', AI_BASE_URL: 'https://api.anthropic.com', AI_MODEL: 'claude-test' })
    expect(s).toEqual({ configured: true, provider: 'anthropic', model: 'claude-test' })
    expect(JSON.stringify(s)).not.toContain('sk-test')
  })
})
