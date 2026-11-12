/**
 * Settings > AI: the on/off switch for this device, the model (Haiku or
 * Sonnet) and, when the site has both keys, the provider; which providers
 * are set up in Cloudflare; and a read-only line saying which model answers.
 *
 * There is nothing to type: the keys belong to the site owner and live in
 * Cloudflare (docs/ai-setup.md). The picks are remembered on this device and
 * sent with each request; the server accepts only these models. `AiUsage` is
 * the matching block for Settings > Data and diagnostics: today's requests
 * against the daily cap.
 */
import { useAiLimit, useAiStatus } from '../ai/client'
import { useAiSettings } from '../ai/aiSettings'
import { CLAUDE_MODELS, type AiProvider, type AiProviderChoice, type ClaudeModelId } from '../api/ai/models'
import { Group, Row, SectionLabel, Segmented, Toggle } from '../ui/Panel'

const MODEL_OPTIONS = CLAUDE_MODELS.map((m) => [m.id, m.short] as [ClaudeModelId, string])
const MODEL_HINT: Record<ClaudeModelId, string> = {
  'claude-haiku-5-5': 'Haiku: fast and inexpensive',
  'claude-sonnet-5-5': 'Sonnet: more careful, costs about 20 times more',
}
const PROVIDER_OPTIONS: [AiProviderChoice, string][] = [
  ['anthropic', 'Claude'],
  ['openrouter', 'OpenRouter'],
  ['auto', 'Auto'],
]
const PROVIDER_NAME: Record<AiProvider, string> = { anthropic: 'Claude', openrouter: 'OpenRouter' }

export function AiSettingsGroup() {
  const enabled = useAiSettings((s) => s.enabled)
  const chosenModel = useAiSettings((s) => s.model)
  const chosenProvider = useAiSettings((s) => s.provider)
  const update = useAiSettings((s) => s.update)
  const status = useAiStatus()
  const capped = useAiLimit((s) => s.limited?.code === 'daily_cap')
  const st = status.data
  const limited = !!st?.configured && (st.usage.limited || capped)
  const both = !!st?.providers?.anthropic && !!st.providers.openrouter
  const via = both && st?.provider ? ` via ${PROVIDER_NAME[st.provider]}` : ''
  const line = status.isPending ? 'Checking…' : !st ? 'AI status is not available right now' : st.configured ? `AI: on (${st.label ?? st.model}${via})` : 'AI is not set up'
  const model = chosenModel ?? st?.defaults?.model ?? CLAUDE_MODELS[0].id
  const provider = chosenProvider ?? st?.defaults?.provider ?? 'auto'

  return (
    <>
      <SectionLabel>AI</SectionLabel>
      <Group>
        <Row label="AI features" hint={enabled ? 'Cleans up and explains radio calls, writes the briefings' : 'Off on this device'}>
          <Toggle checked={enabled} onChange={(v) => update('enabled', v)} label="AI features" />
        </Row>
        {enabled && st?.configured && (
          <Row label="Model" hint={MODEL_HINT[model]}>
            <Segmented label="AI model" value={model} options={MODEL_OPTIONS} onChange={(v) => update('model', v)} />
          </Row>
        )}
        {enabled && both && (
          <Row label="Provider" hint={provider === 'openrouter' ? 'Through the OpenRouter key' : provider === 'auto' ? 'Auto: Claude’s own API' : 'Anthropic’s own API'}>
            <Segmented label="AI provider" value={provider} options={PROVIDER_OPTIONS} onChange={(v) => update('provider', v)} />
          </Row>
        )}
        {st?.providers && (
          <Row label="Set up in Cloudflare">
            <ul className="flex gap-1.5 text-footnote font-medium" aria-label="AI providers set up in Cloudflare">
              {(['anthropic', 'openrouter'] as const).map((p) => (
                <li key={p} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${st.providers[p] ? 'bg-white/10 text-white' : 'text-white/45'}`}>
                  <span className={`size-1.5 rounded-full ${st.providers[p] ? 'bg-atc-purple' : 'bg-white/25'}`} aria-hidden />
                  {PROVIDER_NAME[p]}
                  <span className="sr-only">{st.providers[p] ? ': set up' : ': not set up'}</span>
                </li>
              ))}
            </ul>
          </Row>
        )}
        <div className="py-2.5" role="status" aria-label="AI status">
          <p className="flex items-center gap-2 text-subhead font-medium">
            <span className={`size-2 shrink-0 rounded-full ${!st ? 'bg-atc-muted' : st.configured ? (limited ? 'bg-atc-yellow' : 'bg-atc-purple') : 'bg-white/30'}`} aria-hidden />
            {line}
          </p>
          {limited && <p className="mt-1 text-caption text-atc-muted">Today’s limit is reached. Radio calls are shown as heard, and the rest is back after midnight UTC.</p>}
          {st && !st.configured && (
            <p className="mt-1 text-caption text-atc-muted">
              The site owner switches it on in Cloudflare: Workers &amp; Pages → atc-web → Settings → Variables and Secrets → add the secret ANTHROPIC_API_KEY (or OPENROUTER_API_KEY; Production and Preview), then redeploy. Until then everything works without it: radio calls are shown as heard.
            </p>
          )}
        </div>
      </Group>
      <p className="mt-2 px-1 text-caption text-atc-muted">The AI keys belong to the site and are kept in Cloudflare. This browser never holds or sends one; it only remembers the model and provider picked here.</p>
    </>
  )
}

const STORAGE_LABEL = { kv: 'Cloudflare KV, all regions', cache: 'this region’s cache (approximate)', memory: 'dev server memory' } as const

/** Today's AI requests against the daily cap, for Settings > Data and diagnostics. */
export function AiUsage() {
  const status = useAiStatus()
  const st = status.data
  const u = st?.usage
  const radio = u?.tasks.radioCleanup
  const resets = u ? new Date(u.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null
  return (
    <Group className="py-3">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${!st ? 'bg-atc-muted' : !st.configured ? 'bg-white/30' : u?.limited ? 'bg-atc-yellow' : 'bg-atc-purple'}`} />
        <span className="text-subhead font-semibold">{status.isPending ? 'Checking AI…' : !st ? 'AI status is not available' : !st.configured ? 'AI is not set up' : u?.limited ? 'AI daily limit reached' : `AI: on (${st.label ?? st.model})`}</span>
      </div>
      {u && (
        <dl className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 text-footnote">
          <Stat k="AI requests today" v={`${u.today} of ${u.cap}`} />
          <Stat k="Radio calls" v={radio ? `${radio.today} of ${radio.cap}` : '—'} />
          <Stat k="Starts again" v={resets ?? '—'} />
        </dl>
      )}
      {u && <p className="mt-2.5 text-caption text-atc-muted">Counted in {STORAGE_LABEL[u.storage]}. Answers served from the cache are free and are not counted. The cap is AI_DAILY_CAP in Cloudflare.</p>}
    </Group>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-atc-muted">{k}</dt>
      <dd className="truncate font-medium tabular-nums">{v}</dd>
    </div>
  )
}
