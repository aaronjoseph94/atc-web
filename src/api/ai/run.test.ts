import { afterEach, describe, expect, it, vi } from 'vitest'
import { choiceHeaders } from './models'
import { AI_HEADERS, allowedModel, configuredProviders, modelLabel, optionsFromHeaders, parseJson, resolveAi, runAi } from './run'

afterEach(() => vi.unstubAllGlobals())

describe('resolveAi', () => {
  it('has nothing to use without a key', () => {
    expect(resolveAi({})).toBeNull()
    expect(resolveAi({ ANTHROPIC_API_KEY: '  ' })).toBeNull()
  })
  it('uses the Claude key with Haiku by default', () => {
    expect(resolveAi({ ANTHROPIC_API_KEY: 'a' })).toEqual({ provider: 'anthropic', key: 'a', model: 'claude-haiku-5-5' })
  })
  it('falls back to OpenRouter when only that key exists, with its model name', () => {
    expect(resolveAi({ OPENROUTER_API_KEY: 'or', AI_MODEL: 'claude-sonnet-5-5' })).toEqual({ provider: 'openrouter', key: 'or', model: 'anthropic/claude-sonnet-5.5' })
    expect(resolveAi({ OPENROUTER_API_KEY: 'or' })?.model).toBe('anthropic/claude-haiku-5.5')
  })
  it('honours AI_PROVIDER when that key exists', () => {
    const both = { ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'or' }
    expect(resolveAi(both)?.provider).toBe('anthropic')
    expect(resolveAi({ ...both, AI_PROVIDER: 'auto' })?.provider).toBe('anthropic')
    expect(resolveAi({ ...both, AI_PROVIDER: 'OpenRouter' })?.provider).toBe('openrouter')
    expect(resolveAi({ ANTHROPIC_API_KEY: 'a', AI_PROVIDER: 'openrouter' })?.provider).toBe('anthropic')
  })
  it('AI_MODEL may only name Haiku or Sonnet (either spelling); anything else means Haiku', () => {
    expect(resolveAi({ ANTHROPIC_API_KEY: 'a', AI_MODEL: 'anthropic/claude-sonnet-5.5' })?.model).toBe('claude-sonnet-5-5')
    expect(resolveAi({ ANTHROPIC_API_KEY: 'a', AI_MODEL: 'claude-sonnet-5-5' })?.model).toBe('claude-sonnet-5-5')
    for (const m of ['claude-opus-5-5', 'anthropic/claude-opus-5.5', 'claude-fable-5-2', 'meta/some-model', 'garbage']) {
      expect(resolveAi({ ANTHROPIC_API_KEY: 'a', AI_MODEL: m })?.model, m).toBe('claude-haiku-5-5')
      expect(resolveAi({ OPENROUTER_API_KEY: 'or', AI_MODEL: m })?.model, m).toBe('anthropic/claude-haiku-5.5')
    }
  })
  it('accepts the legacy single-key setup', () => {
    expect(resolveAi({ AI_API_KEY: 'k', AI_BASE_URL: 'https://openrouter.ai/api/v1' })?.provider).toBe('openrouter')
    expect(resolveAi({ AI_API_KEY: 'k' })?.provider).toBe('anthropic')
  })
})

describe('a device’s pick', () => {
  const both = { ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'or' }
  it('chooses Sonnet or Haiku over the site default', () => {
    expect(resolveAi({ ...both, AI_MODEL: 'claude-sonnet-5-5' }, { model: 'claude-haiku-5-5' })?.model).toBe('claude-haiku-5-5')
    expect(resolveAi(both, { model: 'claude-sonnet-5-5' })?.model).toBe('claude-sonnet-5-5')
    expect(resolveAi(both, { model: 'claude-sonnet-5-5', provider: 'openrouter' })).toEqual({ provider: 'openrouter', key: 'or', model: 'anthropic/claude-sonnet-5.5' })
  })
  it('can never choose another model: anything else means the site default', () => {
    for (const m of ['claude-opus-5-5', 'anthropic/claude-opus-5.5', 'claude-fable-5-2', 'openai/gpt-x', '']) {
      expect(resolveAi({ ...both, AI_MODEL: 'claude-sonnet-5-5' }, { model: m })?.model, m).toBe('claude-sonnet-5-5')
      expect(resolveAi(both, { model: m })?.model, m).toBe('claude-haiku-5-5')
    }
  })
  it('chooses the provider over AI_PROVIDER, but only one with a key', () => {
    expect(resolveAi({ ...both, AI_PROVIDER: 'openrouter' }, { provider: 'anthropic' })?.provider).toBe('anthropic')
    expect(resolveAi({ ...both, AI_PROVIDER: 'openrouter' }, { provider: 'auto' })?.provider).toBe('anthropic')
    expect(resolveAi(both, { provider: 'openrouter' })?.provider).toBe('openrouter')
    expect(resolveAi({ ANTHROPIC_API_KEY: 'a' }, { provider: 'openrouter' })?.provider).toBe('anthropic')
    expect(resolveAi({ ...both, AI_PROVIDER: 'openrouter' }, { provider: 'bogus' })?.provider).toBe('openrouter')
    expect(resolveAi({}, { provider: 'openrouter', model: 'claude-sonnet-5-5' })).toBeNull()
  })
  it('travels in two headers, which the server reads strictly', () => {
    const sent = choiceHeaders({ model: 'claude-sonnet-5-5', provider: 'openrouter' })
    expect(sent).toEqual({ [AI_HEADERS.model]: 'claude-sonnet-5-5', [AI_HEADERS.provider]: 'openrouter' })
    expect(optionsFromHeaders((n) => sent[n])).toEqual({ model: 'claude-sonnet-5-5', provider: 'openrouter' })
    expect(choiceHeaders({ model: null, provider: null })).toEqual({})
    expect(choiceHeaders({ model: 'claude-opus-5-5', provider: 'x' })).toEqual({})
    const forged: Record<string, string> = { [AI_HEADERS.model]: 'claude-opus-5-5', [AI_HEADERS.provider]: 'somewhere' }
    expect(optionsFromHeaders((n) => forged[n])).toEqual({})
    expect(optionsFromHeaders((n) => (n === AI_HEADERS.model ? 'Anthropic/Claude-Sonnet-5.5' : null))).toEqual({ model: 'claude-sonnet-5-5' })
  })
})

describe('helpers', () => {
  it('names models as people say them', () => {
    expect(modelLabel('claude-haiku-5-5')).toBe('Claude Haiku 5.5')
    expect(modelLabel('anthropic/claude-sonnet-5.5')).toBe('Claude Sonnet 5.5')
    expect(modelLabel('meta/some-model')).toBe('meta/some-model')
    expect(allowedModel('claude-opus-5-5')).toBeNull()
  })
  it('says which providers have a key, and nothing more', () => {
    expect(configuredProviders({ ANTHROPIC_API_KEY: 'sk-ant-x', OPENROUTER_API_KEY: ' ' })).toEqual({ anthropic: true, openrouter: false })
    expect(configuredProviders({ AI_API_KEY: 'k', AI_BASE_URL: 'https://openrouter.ai/api/v1' })).toEqual({ anthropic: false, openrouter: true })
  })
  it('parses JSON with or without a code fence', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(() => parseJson('nope')).toThrow()
  })
})

describe('the request each provider gets', () => {
  it('Claude: the chosen model with effort, and no thinking budget or sampling parameters', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const out = await runAi({ provider: 'anthropic', key: 'sk-ant-test', model: 'claude-haiku-5-5' }, { system: 's', prompt: 'p', effort: 'low' })
    expect(out).toMatchObject({ text: 'hi', provider: 'anthropic', model: 'claude-haiku-5-5' })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body)) as Record<string, unknown>
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } })
    for (const k of ['thinking', 'temperature', 'top_p', 'top_k']) expect(body, k).not.toHaveProperty(k)
  })
  it('OpenRouter: the OpenRouter name of the model, with the key as a bearer token', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ model: 'anthropic/claude-sonnet-5.5', choices: [{ message: { content: 'hi' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await runAi({ provider: 'openrouter', key: 'sk-or-test', model: 'anthropic/claude-sonnet-5.5' }, { system: 's', prompt: 'p' })
    expect(out).toMatchObject({ text: 'hi', provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sk-or-test')
    expect(JSON.parse(String(init!.body))).toMatchObject({ model: 'anthropic/claude-sonnet-5.5' })
  })
})
