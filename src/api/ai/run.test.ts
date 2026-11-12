import { describe, expect, it } from 'vitest'
import { modelLabel, parseJson, resolveAi } from './run'

describe('resolveAi', () => {
  it('has nothing to use without a key', () => {
    expect(resolveAi({})).toBeNull()
    expect(resolveAi({ ANTHROPIC_API_KEY: '  ' })).toBeNull()
  })
  it('uses the Claude key with the default model', () => {
    expect(resolveAi({ ANTHROPIC_API_KEY: 'a' })).toEqual({ provider: 'anthropic', key: 'a', model: 'claude-opus-5-5' })
  })
  it('falls back to OpenRouter when only that key exists, with its model name', () => {
    expect(resolveAi({ OPENROUTER_API_KEY: 'or', AI_MODEL: 'claude-sonnet-5-5' })).toEqual({ provider: 'openrouter', key: 'or', model: 'anthropic/claude-sonnet-5.5' })
    expect(resolveAi({ OPENROUTER_API_KEY: 'or' })?.model).toBe('anthropic/claude-opus-5.5')
    expect(resolveAi({ OPENROUTER_API_KEY: 'or', AI_MODEL: 'meta/some-model' })?.model).toBe('meta/some-model')
  })
  it('honours AI_PROVIDER when that key exists', () => {
    const both = { ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'or' }
    expect(resolveAi(both)?.provider).toBe('anthropic')
    expect(resolveAi({ ...both, AI_PROVIDER: 'auto' })?.provider).toBe('anthropic')
    expect(resolveAi({ ...both, AI_PROVIDER: 'OpenRouter' })?.provider).toBe('openrouter')
    expect(resolveAi({ ANTHROPIC_API_KEY: 'a', AI_PROVIDER: 'openrouter' })?.provider).toBe('anthropic')
  })
  it('a model id that is not Claude’s falls back to the default on the Claude API', () => {
    expect(resolveAi({ ANTHROPIC_API_KEY: 'a', AI_MODEL: 'anthropic/claude-haiku-5.5' })?.model).toBe('claude-opus-5-5')
    expect(resolveAi({ ANTHROPIC_API_KEY: 'a', AI_MODEL: 'claude-haiku-5-5' })?.model).toBe('claude-haiku-5-5')
  })
  it('accepts the legacy single-key setup', () => {
    expect(resolveAi({ AI_API_KEY: 'k', AI_BASE_URL: 'https://openrouter.ai/api/v1' })?.provider).toBe('openrouter')
    expect(resolveAi({ AI_API_KEY: 'k' })?.provider).toBe('anthropic')
  })
})

describe('helpers', () => {
  it('names models as people say them', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Claude Opus 5.5')
    expect(modelLabel('anthropic/claude-sonnet-5.5')).toBe('Claude Sonnet 5.5')
    expect(modelLabel('meta/some-model')).toBe('meta/some-model')
  })
  it('parses JSON with or without a code fence', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(() => parseJson('nope')).toThrow()
  })
})
