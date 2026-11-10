import { describe, expect, it } from 'vitest'
import { optionsFromHeaders, parseJson, resolveAi } from './run'

describe('resolveAi', () => {
  it('has nothing to use without a key', () => {
    expect(resolveAi({}, {})).toBeNull()
  })
  it('prefers a key typed on the device over the server one', () => {
    const r = resolveAi({ ANTHROPIC_API_KEY: 'server' }, { anthropicKey: 'device' })
    expect(r).toMatchObject({ provider: 'anthropic', key: 'device', keySource: 'device', model: 'claude-opus-5-5' })
  })
  it('falls back to OpenRouter when only that key exists, with its model name', () => {
    expect(resolveAi({}, { openrouterKey: 'or', model: 'claude-sonnet-5-5' })).toMatchObject({ provider: 'openrouter', key: 'or', model: 'anthropic/claude-sonnet-5.5' })
  })
  it('honours an explicit provider choice when that key exists', () => {
    expect(resolveAi({ ANTHROPIC_API_KEY: 'a' }, { openrouterKey: 'or', provider: 'openrouter' })?.provider).toBe('openrouter')
    expect(resolveAi({ ANTHROPIC_API_KEY: 'a' }, { provider: 'openrouter' })?.provider).toBe('anthropic')
  })
  it('accepts the legacy single-key setup', () => {
    expect(resolveAi({ AI_API_KEY: 'k', AI_BASE_URL: 'https://openrouter.ai/api/v1' })?.provider).toBe('openrouter')
    expect(resolveAi({ AI_API_KEY: 'k' })?.provider).toBe('anthropic')
  })
})

describe('helpers', () => {
  it('reads settings from headers', () => {
    const h: Record<string, string> = { 'x-atc-ai-provider': 'anthropic', 'x-atc-anthropic-key': 'k' }
    expect(optionsFromHeaders((n) => h[n] ?? null)).toMatchObject({ provider: 'anthropic', anthropicKey: 'k', openrouterKey: null })
  })
  it('parses JSON with or without a code fence', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(() => parseJson('nope')).toThrow()
  })
})
