import { beforeEach, describe, expect, it } from 'vitest'
import { clearErrors, pushError, recentErrors, redact, RING_SIZE } from './errorLog'

describe('error ring', () => {
  beforeEach(clearErrors)

  it('keeps the latest errors, one copy of a repeat, oldest first', () => {
    pushError([new TypeError('x is undefined')], Date.UTC(2026, 0, 1, 12, 4, 31))
    pushError([new TypeError('x is undefined')], Date.UTC(2026, 0, 1, 12, 4, 32))
    pushError(['fetch failed', { status: 502 }], Date.UTC(2026, 0, 1, 12, 5, 0))
    expect(recentErrors()).toEqual(['12:04:31 TypeError: x is undefined', '12:05:00 fetch failed {"status":502}'])
    for (let i = 0; i < 40; i++) pushError([`e${i}`])
    expect(recentErrors()).toHaveLength(RING_SIZE)
    expect(recentErrors().at(-1)).toMatch(/e39$/)
  })

  it('masks keys before anything is kept', () => {
    expect(redact('bad key sk-ant-api03-abcdefghijklmnop rejected')).toBe('bad key sk-ant-••• rejected')
    expect(redact('Authorization: Bearer abcdefghijklmnopqrstu')).toBe('Authorization: Bearer •••')
    expect(redact('{"x-atc-openrouter-key":"sk-or-v1-0123456789"}')).not.toContain('0123456789')
  })
})
