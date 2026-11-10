/**
 * `POST /api/feedback`: in-app feedback, triaged and (optionally) filed as a
 * GitHub issue. Shared by the Pages Function and the dev server.
 *
 * 1. Validate and rate-limit (per client, in this isolate's memory: a
 *    best-effort guard against a stuck button or a script, not a wall).
 * 2. Triage: the `triageFeedback` AI task with the server's own key
 *    (ANTHROPIC_API_KEY or OPENROUTER_API_KEY), else keyword rules. Keys
 *    typed into Settings on a device are never sent here.
 * 3. With GITHUB_FEEDBACK_TOKEN and GITHUB_FEEDBACK_REPO set, open an issue
 *    with the triage as labels; with GITHUB_FEEDBACK_SCREENSHOT_BRANCH also
 *    set, store the map picture on that branch and link it from the issue.
 *    Otherwise the triage goes back to the sender and into the log.
 */
import { resolveAi, runAi, type AiEnv } from './ai/run'
import { buildTriagePrompt, triageFeedback, type FeedbackContext } from './ai/tasks/triageFeedback'
import { AREAS, normalizeTriage, ruleTriage, type Triage } from './feedbackTriage'

export type FeedbackEnv = AiEnv & {
  /** Fine-grained token with Issues: read and write (and Contents: write for screenshots) on the repo. */
  GITHUB_FEEDBACK_TOKEN?: string
  /** `owner/repo` that receives the issues. */
  GITHUB_FEEDBACK_REPO?: string
  /** Existing branch to store screenshots on; without it screenshots are not kept. */
  GITHUB_FEEDBACK_SCREENSHOT_BRANCH?: string
  /** Set by Cloudflare Pages on deployed builds. */
  CF_PAGES_COMMIT_SHA?: string
}

export type FeedbackBody = { text: string; context: FeedbackContext; screenshot: string | null }

export type FeedbackResult =
  | { ok: true; id: string; triage: Triage; source: 'ai' | 'rules'; issue: { number: number; url: string } | null; screenshot: 'stored' | 'dropped' | 'none' }
  | { ok: false; error: string; status: number }

export const MAX_TEXT = 4000
/** Largest screenshot accepted, as a data URL (a downscaled JPEG of the map is well under this). */
export const MAX_SCREENSHOT = 450_000
/** Largest request body read. */
export const MAX_BODY = MAX_SCREENSHOT + 40_000

const str = (v: unknown, n: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)

/** Keep only the context fields we know, each capped. Throws on a body that can't be feedback. */
export function parseFeedbackBody(raw: unknown): FeedbackBody {
  if (!raw || typeof raw !== 'object') throw new Error('Expected a JSON object.')
  const b = raw as Record<string, unknown>
  const text = typeof b.text === 'string' ? b.text.trim() : ''
  if (text.length < 3) throw new Error('Please write a few words.')
  if (text.length > MAX_TEXT) throw new Error(`Please keep it under ${MAX_TEXT} characters.`)
  const c = (b.context && typeof b.context === 'object' ? b.context : {}) as Record<string, unknown>
  const f = (c.flight && typeof c.flight === 'object' ? c.flight : null) as Record<string, unknown> | null
  const context: FeedbackContext = {
    airport: str(c.airport, 8),
    station: str(c.station, 80),
    flight: f ? { callsign: str(f.callsign, 12), type: str(f.type, 6) } : null,
    mode: str(c.mode, 20),
    panel: str(c.panel, 20),
    version: str(c.version, 40),
    viewport: str(c.viewport, 40),
    userAgent: str(c.userAgent, 240),
    errors: Array.isArray(c.errors) ? c.errors.filter((e): e is string => typeof e === 'string').slice(-15).map((e) => e.slice(0, 400)) : [],
  }
  const shot = typeof b.screenshot === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.screenshot) && b.screenshot.length <= MAX_SCREENSHOT ? b.screenshot : null
  return { text, context, screenshot: shot }
}

/** Sliding-window limits per client key. */
export class RateLimiter {
  private hits = new Map<string, number[]>()
  readonly perWindow: number
  readonly windowMs: number
  readonly perDay: number
  constructor(perWindow = 5, windowMs = 10 * 60_000, perDay = 30) {
    this.perWindow = perWindow
    this.windowMs = windowMs
    this.perDay = perDay
  }

  /** Records the attempt when allowed. */
  check(key: string, now: number): { ok: true } | { ok: false; retryAfterS: number } {
    const day = 24 * 3_600_000
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < day)
    const recent = list.filter((t) => now - t < this.windowMs)
    if (recent.length >= this.perWindow) return { ok: false, retryAfterS: Math.ceil((recent[0] + this.windowMs - now) / 1000) }
    if (list.length >= this.perDay) return { ok: false, retryAfterS: Math.ceil((list[0] + day - now) / 1000) }
    list.push(now)
    this.hits.set(key, list)
    // Don't let a long-lived isolate collect keys forever.
    if (this.hits.size > 5000) this.hits.delete(this.hits.keys().next().value!)
    return { ok: true }
  }
}

/** One limiter per isolate (Workers) or process (dev server). */
export const feedbackLimiter = new RateLimiter()

/** `@name` in text people typed would notify that GitHub user; a zero-width space defuses it. */
export function defuseMentions(s: string): string {
  return s.replace(/@(?=[A-Za-z0-9-])/g, '@​')
}

/** Markdown body for the GitHub issue. Pure, so it can be tested. */
export function issueBody(id: string, body: FeedbackBody, triage: Triage, source: 'ai' | 'rules', screenshotUrl: string | null, commit?: string | null): string {
  const c = body.context
  const area = AREAS[triage.area]
  const fence = (s: string) => s.replace(/```/g, 'ʼʼʼ')
  const lines = [
    '### Feedback',
    '',
    '```text',
    fence(body.text),
    '```',
    '',
    `### Triage (${source === 'ai' ? 'AI' : 'keyword rules'})`,
    '',
    `- **Category:** ${triage.category}`,
    `- **Severity:** ${triage.severity}`,
    `- **Likely area:** ${area ? `${area.label} — \`${area.paths}\`` : 'not sure'}`,
  ]
  if (triage.suggestedFix) lines.push(`- **Suggested fix:** ${defuseMentions(triage.suggestedFix)}`)
  lines.push(
    '',
    '### Context',
    '',
    '| | |',
    '| --- | --- |',
    `| Airport | ${c.airport ?? '—'} |`,
    `| Station | ${c.station ?? '—'} |`,
    `| Selected flight | ${c.flight?.callsign ? `${c.flight.callsign}${c.flight.type ? ` (${c.flight.type})` : ''}` : '—'} |`,
    `| Mode / panel | ${c.mode ?? '—'} / ${c.panel ?? '—'} |`,
    `| App version | ${c.version ?? '—'}${commit ? ` (${commit.slice(0, 7)})` : ''} |`,
    `| Viewport | ${c.viewport ?? '—'} |`,
    `| Browser | ${(c.userAgent ?? '—').replace(/\|/g, '/')} |`,
  )
  if (c.errors?.length) lines.push('', '<details><summary>Recent console errors</summary>', '', '```text', ...c.errors.map(fence), '```', '', '</details>')
  if (screenshotUrl) lines.push('', '### Map at the time', '', `![map](${screenshotUrl})`)
  else if (body.screenshot) lines.push('', '_A map screenshot was attached but not stored (set GITHUB_FEEDBACK_SCREENSHOT_BRANCH to keep them)._')
  lines.push('', `<sub>Sent from the app's feedback sheet · ${id}</sub>`)
  return lines.join('\n')
}

export function issueLabels(t: Triage): string[] {
  return ['feedback', t.category, `severity: ${t.severity}`, ...(t.area !== 'other' ? [`area: ${t.area}`] : [])]
}

type Deps = { fetch?: typeof fetch; now?: number; limiter?: RateLimiter; id?: string }

async function runTriage(body: FeedbackBody, env: FeedbackEnv): Promise<{ triage: Triage; source: 'ai' | 'rules' }> {
  const ai = resolveAi(env, {})
  if (ai) {
    try {
      const out = await runAi(ai, {
        system: triageFeedback.system,
        prompt: buildTriagePrompt({ text: body.text, context: body.context }),
        schema: triageFeedback.schema,
        effort: triageFeedback.effort,
        maxTokens: triageFeedback.maxTokens,
        timeoutMs: triageFeedback.timeoutMs,
      })
      const t = normalizeTriage(out.json)
      if (t) return { triage: t, source: 'ai' }
    } catch (err) {
      console.warn('[feedback] AI triage failed, using rules:', err instanceof Error ? err.message : err)
    }
  }
  return { triage: ruleTriage(body.text), source: 'rules' }
}

const gh = (token: string) => ({ authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'atc-web-feedback', 'content-type': 'application/json' })

async function storeScreenshot(env: FeedbackEnv, id: string, dataUrl: string, f: typeof fetch): Promise<string | null> {
  const branch = env.GITHUB_FEEDBACK_SCREENSHOT_BRANCH
  if (!branch || !env.GITHUB_FEEDBACK_TOKEN || !env.GITHUB_FEEDBACK_REPO) return null
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  const path = `feedback/${id}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`
  const res = await f(`https://api.github.com/repos/${env.GITHUB_FEEDBACK_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: gh(env.GITHUB_FEEDBACK_TOKEN),
    body: JSON.stringify({ message: `Feedback screenshot ${id}`, content: m[2], branch }),
  })
  if (!res.ok) {
    console.warn(`[feedback] screenshot upload failed: ${res.status}`)
    return null
  }
  return `https://github.com/${env.GITHUB_FEEDBACK_REPO}/blob/${encodeURIComponent(branch)}/${path}?raw=true`
}

export async function handleFeedback(raw: string, env: FeedbackEnv, clientKey: string, deps: Deps = {}): Promise<{ status: number; body: FeedbackResult }> {
  const now = deps.now ?? Date.now()
  const f = deps.fetch ?? fetch
  let body: FeedbackBody
  try {
    body = parseFeedbackBody(JSON.parse(raw))
  } catch (err) {
    const error = err instanceof SyntaxError ? 'Expected JSON.' : err instanceof Error ? err.message : 'Bad request'
    return { status: 400, body: { ok: false, error, status: 400 } }
  }
  const gate = (deps.limiter ?? feedbackLimiter).check(clientKey, now)
  if (!gate.ok) {
    const min = Math.max(1, Math.round(gate.retryAfterS / 60))
    return { status: 429, body: { ok: false, error: `Thanks, that's plenty for now. Try again in about ${min} min.`, status: 429 } }
  }

  const id = deps.id ?? `fb-${now.toString(36)}-${crypto.randomUUID().slice(0, 6)}`
  const { triage: t, source } = await runTriage(body, env)

  let issue: { number: number; url: string } | null = null
  let screenshot: 'stored' | 'dropped' | 'none' = body.screenshot ? 'dropped' : 'none'
  const repo = env.GITHUB_FEEDBACK_REPO
  if (env.GITHUB_FEEDBACK_TOKEN && repo && /^[\w.-]+\/[\w.-]+$/.test(repo)) {
    try {
      const shotUrl = body.screenshot ? await storeScreenshot(env, id, body.screenshot, f) : null
      if (shotUrl) screenshot = 'stored'
      const res = await f(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: gh(env.GITHUB_FEEDBACK_TOKEN),
        body: JSON.stringify({ title: defuseMentions(`[${t.category}] ${t.summary}`), body: issueBody(id, body, t, source, shotUrl, env.CF_PAGES_COMMIT_SHA), labels: issueLabels(t) }),
      })
      if (res.ok) {
        const j = (await res.json()) as { number?: number; html_url?: string }
        if (typeof j.number === 'number' && typeof j.html_url === 'string') issue = { number: j.number, url: j.html_url }
      } else {
        console.warn(`[feedback] GitHub issue failed: ${res.status}`)
      }
    } catch (err) {
      console.warn('[feedback] GitHub unreachable:', err instanceof Error ? err.message : err)
    }
  }

  // The record of it: in the Pages Functions log when no issue was filed, a pointer when one was.
  console.warn(`[feedback] ${JSON.stringify({ id, source, ...t, issue: issue?.url ?? null, airport: body.context.airport, text: issue ? undefined : body.text.slice(0, 1000) })}`)
  return { status: 200, body: { ok: true, id, triage: t, source, issue, screenshot } }
}
