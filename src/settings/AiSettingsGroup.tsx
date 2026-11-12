/**
 * Settings > AI: the on/off switch for this device and a read-only line
 * saying whether the site has AI set up and which model answers.
 *
 * There is nothing to type: the key belongs to the site owner and lives in
 * Cloudflare (docs/ai-setup.md). `AiUsage` is the matching block for
 * Settings > Data and diagnostics: today's requests against the daily cap.
 */
import { useAiLimit, useAiStatus } from '../ai/client'
import { useAiSettings } from '../ai/aiSettings'
import { Group, Row, SectionLabel, Toggle } from '../ui/Panel'

export function AiSettingsGroup() {
  const enabled = useAiSettings((s) => s.enabled)
  const update = useAiSettings((s) => s.update)
  const status = useAiStatus()
  const capped = useAiLimit((s) => s.limited?.code === 'daily_cap')
  const st = status.data
  const limited = !!st?.configured && (st.usage.limited || capped)
  const line = status.isPending ? 'Checking…' : !st ? 'AI status is not available right now' : st.configured ? `AI: on (${st.label ?? st.model}, set in Cloudflare)` : 'AI is not set up'

  return (
    <>
      <SectionLabel>AI</SectionLabel>
      <Group>
        <Row label="AI features" hint={enabled ? 'Cleans up and explains radio calls, writes the briefings' : 'Off on this device'}>
          <Toggle checked={enabled} onChange={(v) => update('enabled', v)} label="AI features" />
        </Row>
        <div className="py-2.5" role="status" aria-label="AI status">
          <p className="flex items-center gap-2 text-subhead font-medium">
            <span className={`size-2 shrink-0 rounded-full ${!st ? 'bg-atc-muted' : st.configured ? (limited ? 'bg-atc-yellow' : 'bg-atc-purple') : 'bg-white/30'}`} aria-hidden />
            {line}
          </p>
          {limited && <p className="mt-1 text-caption text-atc-muted">Today’s limit is reached. Radio calls are shown as heard, and the rest is back after midnight UTC.</p>}
          {st && !st.configured && (
            <p className="mt-1 text-caption text-atc-muted">
              The site owner switches it on in Cloudflare: Workers &amp; Pages → atc-web → Settings → Variables and Secrets → add the secret ANTHROPIC_API_KEY (Production and Preview), then redeploy. Until then everything works without it: radio calls are shown as heard.
            </p>
          )}
        </div>
      </Group>
      <p className="mt-2 px-1 text-caption text-atc-muted">The AI key belongs to the site and is kept in Cloudflare. This browser never holds or sends one.</p>
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
