import { describe, expect, it, vi } from 'vitest'
import { buildTriagePrompt, triageFeedback } from './ai/tasks/triageFeedback'
import { buildExplainSightingPrompt, explainSighting, parseExplainSighting } from './ai/tasks/explainSighting'
import { defuseMentions, handleFeedback, issueBody, issueLabels, parseFeedbackBody, RateLimiter } from './feedbackHandler'
import { guessArea, normalizeTriage, ruleTriage, summarize } from './feedbackTriage'

describe('ruleTriage (no AI)', () => {
  it('sorts reports by keywords', () => {
    expect(ruleTriage('The map goes blank when I zoom out on my iPhone. Every time.')).toMatchObject({ category: 'bug', severity: 'critical', area: 'map' })
    expect(ruleTriage('The audio stops after a minute and the transcript is stuck')).toMatchObject({ category: 'bug', severity: 'medium', area: 'radio' })
    expect(ruleTriage('Would be nice to have a dark/light toggle for the weather panel')).toMatchObject({ category: 'idea', severity: 'low', area: 'weather' })
    expect(ruleTriage('The logo for Flair is wrong, it shows the WestJet airline logo')).toMatchObject({ category: 'data', area: 'airlines' })
    expect(ruleTriage('How do I hear the ground frequency?')).toMatchObject({ category: 'question', area: 'radio' })
    expect(ruleTriage('The tags overlap on approach when I zoom out, and one tag hides the other.')).toMatchObject({ category: 'bug', area: 'map' })
    expect(ruleTriage('nice app')).toMatchObject({ category: 'idea', area: 'other', suggestedFix: null })
  })

  it('summarises to the first sentence, cut to fit a title', () => {
    expect(summarize('Runway 28C is drawn in the wrong place. Also the taxiway letters overlap.')).toBe('Runway 28C is drawn in the wrong place.')
    expect(summarize('x'.repeat(300)).length).toBeLessThanOrEqual(96)
    expect(guessArea('the flight card shows the wrong route and origin')).toBe('flight')
  })

  it('accepts only well-formed AI answers', () => {
    expect(normalizeTriage({ category: 'bug', severity: 'high', summary: 'Map blank on iOS', area: 'map', suggestedFix: 'Check WebGL context loss.' })).toEqual({ category: 'bug', severity: 'high', summary: 'Map blank on iOS', area: 'map', suggestedFix: 'Check WebGL context loss.' })
    expect(normalizeTriage({ category: 'bug', severity: 'high', summary: 'x', area: 'nowhere', suggestedFix: '' })).toMatchObject({ area: 'other', suggestedFix: null })
    expect(normalizeTriage({ category: 'rant', severity: 'high', summary: 'x', area: 'map', suggestedFix: '' })).toBeNull()
    expect(normalizeTriage(null)).toBeNull()
  })
})

describe('AI task definitions', () => {
  it('triageFeedback builds a prompt with the context and lists every field as required', () => {
    const p = buildTriagePrompt({ text: 'Audio cuts out', context: { airport: 'JFK', station: 'Kennedy Tower', flight: { callsign: 'DAL1', type: 'A321' }, errors: ['TypeError: x is undefined'] } })
    expect(p).toContain('Audio cuts out')
    expect(p).toContain('JFK')
    expect(p).toContain('DAL1 A321')
    expect(p).toContain('TypeError')
    expect(() => buildTriagePrompt({ text: '  ' })).toThrow()
    const schema = triageFeedback.schema as { required: string[]; properties: Record<string, unknown> }
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort())
    expect(triageFeedback.system).not.toContain('Audio cuts out')
  })

  it('explainSighting validates its input and trims the answer', () => {
    const p = buildExplainSightingPrompt({ type: 'A124', name: 'Antonov An-124 Ruslan', airport: 'ORD', airportName: "Chicago O'Hare", airportClass: 'gateway', reasons: ['Rare here'] })
    expect(p).toContain('A124 (Antonov An-124 Ruslan)')
    expect(() => buildExplainSightingPrompt({ type: 'not a type!', name: '', airport: 'ORD', airportName: '', airportClass: 'hub', reasons: [] })).toThrow()
    expect(parseExplainSighting({ line: '  One of the largest\ncargo aircraft flying.  ' })).toEqual({ line: 'One of the largest cargo aircraft flying.' })
    expect(parseExplainSighting({ line: 'no' })).toBeNull()
    expect(parseExplainSighting({ line: 'x'.repeat(400) })!.line.length).toBeLessThanOrEqual(180)
    expect(explainSighting.cacheS).toBe(86_400)
  })
})

describe('parseFeedbackBody', () => {
  it('keeps known context fields, capped, and drops a bad screenshot', () => {
    const b = parseFeedbackBody({ text: '  Map is blank  ', context: { airport: 'ORD', flight: { callsign: 'UAL1', type: 'B38M', owner: 'x' }, errors: ['a', 3, 'b'], extra: 'no' }, screenshot: 'javascript:alert(1)' })
    expect(b.text).toBe('Map is blank')
    expect(b.context.flight).toEqual({ callsign: 'UAL1', type: 'B38M' })
    expect(b.context.errors).toEqual(['a', 'b'])
    expect(b.screenshot).toBeNull()
    expect('extra' in b.context).toBe(false)
    expect(parseFeedbackBody({ text: 'ok then', screenshot: 'data:image/jpeg;base64,AAAA' }).screenshot).toBe('data:image/jpeg;base64,AAAA')
    expect(() => parseFeedbackBody({ text: 'x' })).toThrow()
    expect(() => parseFeedbackBody({ text: 'x'.repeat(5000) })).toThrow()
  })
})

describe('RateLimiter', () => {
  it('allows a few per window per client', () => {
    const l = new RateLimiter(2, 60_000, 3)
    expect(l.check('a', 0).ok).toBe(true)
    expect(l.check('a', 1).ok).toBe(true)
    expect(l.check('a', 2)).toMatchObject({ ok: false })
    expect(l.check('b', 2).ok).toBe(true)
    expect(l.check('a', 61_000).ok).toBe(true)
    expect(l.check('a', 130_000)).toMatchObject({ ok: false }) // three today already
  })
})

describe('issue text', () => {
  const body = parseFeedbackBody({ text: 'Hey @octocat the ``` map is blank', context: { airport: 'JFK', errors: ['Error: boom'] }, screenshot: 'data:image/jpeg;base64,AAAA' })
  const t = ruleTriage(body.text)

  it('defuses mentions and fences the text', () => {
    const md = issueBody('fb-1', body, t, 'rules', null, 'abcdef1234')
    // Inside the fenced block a mention notifies nobody; text outside it is defused.
    expect(md).toContain('```text\nHey @octocat the ʼʼʼ map is blank\n```')
    expect(md.match(/```/g)!.length % 2).toBe(0)
    expect(md).toContain('Recent console errors')
    expect(md).toContain('(abcdef1)')
    expect(md).toContain('not stored')
    expect(defuseMentions('mail a@b.c and @team')).toBe('mail a@​b.c and @​team')
  })

  it('labels by category, severity and area', () => {
    expect(issueLabels({ category: 'bug', severity: 'high', summary: 's', area: 'map', suggestedFix: null })).toEqual(['feedback', 'bug', 'severity: high', 'area: map'])
    expect(issueLabels({ category: 'idea', severity: 'low', summary: 's', area: 'other', suggestedFix: null })).toEqual(['feedback', 'idea', 'severity: low'])
  })
})

describe('handleFeedback', () => {
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  it('without AI or GitHub returns the rule triage', async () => {
    quiet()
    const f = vi.fn()
    const out = await handleFeedback(JSON.stringify({ text: 'The radio audio keeps cutting out', context: { airport: 'ORD' } }), {}, 'c1', { fetch: f, limiter: new RateLimiter(), id: 'fb-x' })
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ ok: true, id: 'fb-x', source: 'rules', issue: null, screenshot: 'none', triage: { category: 'bug', area: 'radio' } })
    expect(f).not.toHaveBeenCalled()
  })

  it('files a GitHub issue with labels when configured', async () => {
    quiet()
    const f = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ number: 42, html_url: 'https://github.com/o/r/issues/42' }), { status: 201 }))
    const env = { GITHUB_FEEDBACK_TOKEN: 't0k', GITHUB_FEEDBACK_REPO: 'o/r' }
    const out = await handleFeedback(JSON.stringify({ text: 'Please add a dark mode for the weather panel', screenshot: 'data:image/jpeg;base64,AAAA' }), env, 'c1', { fetch: f as unknown as typeof fetch, limiter: new RateLimiter(), id: 'fb-y' })
    expect(out.body).toMatchObject({ ok: true, issue: { number: 42 }, screenshot: 'dropped' })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/o/r/issues')
    const sent = JSON.parse(String(init!.body))
    expect(sent.labels).toEqual(['feedback', 'idea', 'severity: low', 'area: weather'])
    expect(sent.title).toMatch(/^\[idea\] /)
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer t0k')
  })

  it('stores the screenshot on the configured branch and links it', async () => {
    quiet()
    const f = vi.fn(async (url: string) => (url.includes('/contents/') ? new Response('{}', { status: 201 }) : new Response(JSON.stringify({ number: 7, html_url: 'u' }), { status: 201 })))
    const env = { GITHUB_FEEDBACK_TOKEN: 't', GITHUB_FEEDBACK_REPO: 'o/r', GITHUB_FEEDBACK_SCREENSHOT_BRANCH: 'feedback-assets' }
    const out = await handleFeedback(JSON.stringify({ text: 'The map is wrong here', screenshot: 'data:image/jpeg;base64,AAAA' }), env, 'c1', { fetch: f as unknown as typeof fetch, limiter: new RateLimiter(), id: 'fb-z' })
    expect(out.body).toMatchObject({ screenshot: 'stored', issue: { number: 7 } })
    expect(f.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r/contents/feedback/fb-z.jpg')
    const issue = JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body))
    expect(issue.body).toContain('https://github.com/o/r/blob/feedback-assets/feedback/fb-z.jpg?raw=true')
  })

  it('still answers when GitHub fails', async () => {
    quiet()
    const f = vi.fn(async () => new Response('nope', { status: 403 }))
    const out = await handleFeedback(JSON.stringify({ text: 'Something is broken' }), { GITHUB_FEEDBACK_TOKEN: 't', GITHUB_FEEDBACK_REPO: 'o/r' }, 'c', { fetch: f as unknown as typeof fetch, limiter: new RateLimiter() })
    expect(out.body).toMatchObject({ ok: true, issue: null })
  })

  it('rejects bad bodies and rate-limits', async () => {
    quiet()
    expect((await handleFeedback('not json', {}, 'c')).status).toBe(400)
    const limiter = new RateLimiter(1, 60_000, 10)
    const ok = JSON.stringify({ text: 'hello there' })
    expect((await handleFeedback(ok, {}, 'c', { limiter })).status).toBe(200)
    const again = await handleFeedback(ok, {}, 'c', { limiter })
    expect(again.status).toBe(429)
    expect(again.body).toMatchObject({ ok: false })
  })
})
