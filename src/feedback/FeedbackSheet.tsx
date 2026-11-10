/**
 * "Send feedback": a few words, optionally a picture of the map, and the
 * app's context, posted to `/api/feedback`. The answer is the triage (AI
 * when the server has a key, else keyword rules), shown back as "here's what
 * we understood", with the GitHub issue link when one was filed.
 */
import { ChevronDown, CircleCheck, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AREAS, type Triage } from '../api/feedbackTriage'
import { Group, Sheet, Toggle } from '../ui/Panel'
import { StateAction } from '../ui/States'
import { installErrorLog } from './errorLog'
import { closeFeedback, postFeedback, useFeedback, type Sent } from './store'

// Start keeping recent errors as soon as the app loads, so a report can include them.
installErrorLog()

const MAX = 4000

type Phase = { s: 'edit' } | { s: 'sending' } | { s: 'done'; r: Sent } | { s: 'error'; message: string }

const CATEGORY: Record<Triage['category'], string> = { bug: 'Bug', idea: 'Idea', data: 'Data fix', question: 'Question' }
const SEVERITY: Record<Triage['severity'], string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }

export function FeedbackSheet() {
  const open = useFeedback((s) => s.open)
  const context = useFeedback((s) => s.context)
  const screenshot = useFeedback((s) => s.screenshot)
  const [text, setText] = useState('')
  const [withShot, setWithShot] = useState(true)
  const [details, setDetails] = useState(false)
  const [phase, setPhase] = useState<Phase>({ s: 'edit' })

  // A fresh sheet each time it opens after a report went through; a failed draft is kept.
  useEffect(() => {
    if (open && phase.s === 'done') {
      setText('')
      setPhase({ s: 'edit' })
    }
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const send = async () => {
    if (text.trim().length < 3 || phase.s === 'sending') return
    setPhase({ s: 'sending' })
    try {
      const r = await postFeedback({ text: text.trim(), context, screenshot: withShot ? screenshot : null })
      setPhase({ s: 'done', r })
    } catch (err) {
      setPhase({ s: 'error', message: err instanceof Error ? err.message : 'Couldn’t send. Check your connection and try again.' })
    }
  }

  return (
    <Sheet open={open} title={phase.s === 'done' ? 'Thanks' : 'Send feedback'} onClose={closeFeedback}>
      {phase.s === 'done' ? (
        <Understood r={phase.r} onAnother={() => { setText(''); setPhase({ s: 'edit' }) }} />
      ) : (
        <div className="space-y-3 pt-1">
          <label className="block">
            <span className="sr-only">Your feedback</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX))}
              rows={5}
              placeholder="What went wrong, what’s missing, or what would you like to see?"
              className="block w-full resize-none rounded-2xl bg-white/[0.07] px-3.5 py-3 text-subhead text-white outline-none ring-1 ring-inset ring-white/[0.08] placeholder:text-white/40 focus:ring-2 focus:ring-atc-purple/70"
            />
            <span className="mt-1 flex justify-end px-1 text-caption tabular-nums text-white/35">
              {text.length} / {MAX}
            </span>
          </label>

          <Group>
            <div className="flex min-h-12 items-center gap-3 py-2">
              {screenshot && withShot ? (
                <img src={screenshot} alt="Map picture to be attached" className="h-12 w-[4.5rem] shrink-0 rounded-lg object-cover ring-1 ring-white/10" />
              ) : (
                <span className="grid h-12 w-[4.5rem] shrink-0 place-items-center rounded-lg bg-white/[0.05] text-caption text-white/35">{screenshot ? 'Off' : 'No map'}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-subhead font-medium">Include a picture of the map</span>
                <span className="block text-caption text-atc-muted">Just the map, as it was when you opened this.</span>
              </span>
              <Toggle checked={withShot && !!screenshot} onChange={setWithShot} label="Include a picture of the map" />
            </div>
          </Group>

          <button type="button" aria-expanded={details} className="pressable flex items-center gap-1 rounded-lg px-1 text-footnote font-semibold text-white/55 hover:text-white/80" onClick={() => setDetails(!details)}>
            Details sent along
            <ChevronDown className={`size-4 transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] ${details ? 'rotate-180' : ''}`} />
          </button>
          {details && context && (
            <dl className="motion-rise grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-2xl bg-white/[0.04] px-3.5 py-3 text-footnote">
              <dt className="text-atc-muted">Airport</dt>
              <dd className="truncate">{context.airport ?? '—'}{context.station ? ` · ${context.station}` : ''}</dd>
              <dt className="text-atc-muted">Flight</dt>
              <dd className="truncate">{context.flight?.callsign ? `${context.flight.callsign}${context.flight.type ? ` (${context.flight.type})` : ''}` : '—'}</dd>
              <dt className="text-atc-muted">Version</dt>
              <dd className="truncate">{context.version}</dd>
              <dt className="text-atc-muted">Screen</dt>
              <dd className="truncate">{context.viewport}</dd>
              <dt className="text-atc-muted">Errors</dt>
              <dd className="truncate">{context.errors?.length ? `${context.errors.length} recent` : 'none'}</dd>
              <dt className="text-atc-muted">Browser</dt>
              <dd className="line-clamp-2 break-all text-white/70">{context.userAgent}</dd>
            </dl>
          )}

          {phase.s === 'error' && (
            <p role="alert" className="rounded-2xl bg-[#3a1418]/90 px-3.5 py-2.5 text-footnote text-white ring-1 ring-atc-live/40">
              {phase.message}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="min-w-0 text-caption text-atc-muted">Goes to the app’s developer. Please leave out personal details.</p>
            <StateAction primary busy={phase.s === 'sending'} onClick={() => void send()}>
              {phase.s === 'sending' ? 'Sending…' : phase.s === 'error' ? 'Try again' : 'Send'}
            </StateAction>
          </div>
        </div>
      )}
    </Sheet>
  )
}

function Understood({ r, onAnother }: { r: Sent; onAnother: () => void }) {
  const t = r.triage
  const area = AREAS[t.area]
  return (
    <div className="space-y-3 pt-1">
      <p className="flex items-center gap-2 text-subhead font-semibold">
        <CircleCheck className="size-5 shrink-0 text-emerald-400" aria-hidden />
        Here’s what we understood
      </p>
      <Group className="space-y-2 py-3">
        <div className="flex flex-wrap items-center gap-1.5 text-caption font-semibold">
          <span className="rounded-full bg-atc-card/80 px-2 py-0.5 text-white">{CATEGORY[t.category]}</span>
          <span className={`rounded-full px-2 py-0.5 ${t.severity === 'critical' || t.severity === 'high' ? 'bg-atc-live/25 text-[#ffb4b4]' : 'bg-white/10 text-white/75'}`}>{SEVERITY[t.severity]} priority</span>
          {r.source === 'ai' && (
            <span className="flex items-center gap-1 text-[#C9BCFF]">
              <Sparkles className="size-3" aria-hidden /> AI triage
            </span>
          )}
        </div>
        <p className="text-subhead font-semibold leading-snug">{t.summary}</p>
        {area && <p className="text-footnote text-white/60">Probably: {area.label}</p>}
        {t.suggestedFix && <p className="text-footnote leading-snug text-white/70">{t.suggestedFix}</p>}
      </Group>
      <p className="px-1 text-footnote text-white/60">
        {r.issue ? (
          <>
            Filed as{' '}
            <a href={r.issue.url} target="_blank" rel="noreferrer" className="font-semibold text-[#C9BCFF] underline-offset-2 hover:underline">
              issue #{r.issue.number}
            </a>
            . Thank you.
          </>
        ) : (
          'Logged for the developer. Thank you.'
        )}
      </p>
      <div className="flex justify-end gap-2">
        <StateAction onClick={onAnother}>Send another</StateAction>
        <StateAction primary onClick={closeFeedback}>
          Done
        </StateAction>
      </div>
    </div>
  )
}
