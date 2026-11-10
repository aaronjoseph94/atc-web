/**
 * Settings > AI: where the owner pastes a Claude and/or OpenRouter key, picks
 * the provider and model, and checks the connection. Keys stay in this
 * browser and are only ever sent to this site's own `/api/ai`.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { askAi, getAiRunStatus } from '../ai/client'
import { useAiSettings, type AiProviderChoice } from '../ai/aiSettings'
import { CLAUDE_MODELS } from '../api/ai/run'
import { Group, Row, SectionLabel, Segmented, Toggle } from '../ui/Panel'

const inputCls =
  'h-10 w-full rounded-xl bg-white/[0.08] pl-3 pr-10 font-mono text-footnote text-white outline-none ring-1 ring-inset ring-white/[0.08] placeholder:font-sans placeholder:text-white/35 focus:ring-2 focus:ring-atc-purple/70'

function KeyField({ label, value, onChange, placeholder, help }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; help: string }) {
  const [show, setShow] = useState(false)
  return (
    <label className="block py-2.5">
      <span className="mb-1.5 flex items-center gap-1.5 text-subhead font-medium">
        <KeyRound className="size-3.5 text-white/50" strokeWidth={2.5} aria-hidden />
        {label}
      </span>
      <span className="relative block">
        <input
          type={show ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          className={inputCls}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          aria-label={show ? `Hide ${label}` : `Show ${label}`}
          className="pressable absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-white/55 hover:text-white"
          onClick={() => setShow((v) => !v)}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </span>
      <span className="mt-1 block text-caption text-atc-muted">{help}</span>
    </label>
  )
}

export function AiSettingsGroup() {
  const s = useAiSettings()
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['ai-run-status', s.provider, s.model, !!s.anthropicKey, !!s.openrouterKey], queryFn: getAiRunStatus, staleTime: 30_000, retry: 0 })
  const [test, setTest] = useState<{ state: 'idle' | 'busy' | 'ok' | 'fail'; message?: string }>({ state: 'idle' })

  const runTest = async () => {
    setTest({ state: 'busy' })
    try {
      await askAi('ping', {}, { fresh: true })
      setTest({ state: 'ok', message: 'Connected. AI features are ready.' })
    } catch (err) {
      setTest({ state: 'fail', message: err instanceof Error ? err.message : 'Test failed' })
    }
    void qc.invalidateQueries({ queryKey: ['ai-run-status'] })
  }

  const st = status.data
  const summary = !s.enabled
    ? 'AI features are off.'
    : st?.configured
      ? `Using ${st.provider === 'openrouter' ? 'OpenRouter' : 'Claude'} · ${st.model}${st.keySource === 'server' ? ' (key set on the server)' : ''}`
      : 'Add a Claude or OpenRouter key to turn on the AI features.'

  return (
    <>
      <SectionLabel>AI</SectionLabel>
      <Group>
        <Row label="AI features" hint={summary}>
          <Toggle checked={s.enabled} onChange={(v) => s.update('enabled', v)} label="AI features" />
        </Row>
        {s.enabled && (
          <>
            <Row label="Provider">
              <Segmented<AiProviderChoice>
                label="AI provider"
                value={s.provider}
                options={[
                  ['auto', 'Auto'],
                  ['anthropic', 'Claude'],
                  ['openrouter', 'OpenRouter'],
                ]}
                onChange={(v) => s.update('provider', v)}
              />
            </Row>
            <Row label="Model">
              <select
                aria-label="AI model"
                className="max-w-[11rem] truncate rounded-lg bg-white/10 px-2.5 py-1.5 text-footnote font-medium outline-none ring-1 ring-white/10 focus:ring-atc-yellow/60"
                value={s.model}
                onChange={(e) => s.update('model', e.target.value)}
              >
                {CLAUDE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {m.note}
                  </option>
                ))}
              </select>
            </Row>
            <KeyField
              label="Claude API key"
              value={s.anthropicKey}
              onChange={(v) => s.update('anthropicKey', v)}
              placeholder="sk-ant-…"
              help="From console.anthropic.com → API keys."
            />
            <KeyField
              label="OpenRouter API key"
              value={s.openrouterKey}
              onChange={(v) => s.update('openrouterKey', v)}
              placeholder="sk-or-…"
              help="From openrouter.ai → Keys. Used when the provider is OpenRouter, or when there is no Claude key."
            />
            <div className="flex flex-wrap items-center gap-2 py-2.5">
              <button
                type="button"
                className="pressable rounded-full bg-atc-card px-3.5 py-1.5 text-footnote font-semibold text-white hover:brightness-110 disabled:opacity-50"
                onClick={() => void runTest()}
                disabled={test.state === 'busy'}
              >
                {test.state === 'busy' ? 'Testing…' : 'Test connection'}
              </button>
              {(s.anthropicKey || s.openrouterKey) && (
                <button type="button" className="pressable rounded-full bg-white/10 px-3.5 py-1.5 text-footnote font-semibold text-white/80 hover:bg-white/15" onClick={s.clearKeys}>
                  Remove keys
                </button>
              )}
              {test.message && (
                <span role="status" className={`text-caption font-medium ${test.state === 'ok' ? 'text-emerald-400' : 'text-atc-live'}`}>
                  {test.message}
                </span>
              )}
            </div>
          </>
        )}
      </Group>
      <p className="mt-2 px-1 text-caption text-atc-muted">
        Keys stay in this browser and are sent only to this site, per request, to reach the model; they are never stored on the server. To share one key with every visitor instead, set ANTHROPIC_API_KEY or OPENROUTER_API_KEY as a secret in Cloudflare Pages.
      </p>
    </>
  )
}
