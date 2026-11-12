/**
 * The glossary: every built-in ATC term, searchable, each opening to its
 * explanation and diagram, plus the Learn-mode switch. A word that isn't in
 * the glossary can be asked of the AI (when the site has it set up); its answer is
 * marked with the sparkle and cached for a month.
 */
import { ChevronDown, Search, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AiMark } from '../insights/AiMark'
import { useAiReady, useAiTask } from '../insights/ai'
import { useInsightSettings } from '../insights/insightSettings'
import { parseTerm } from '../insights/parse'
import { Group, Row, Sheet, Toggle } from '../ui/Panel'
import { searchGlossary } from './detect'
import { Diagram } from './diagrams'
import type { GlossaryEntry, TermCategory } from './glossary'
import { useLearn } from './learnStore'

const ORDER: TermCategory[] = ['Clearance', 'Ground', 'Approach', 'Altitude', 'Radio', 'Emergency', 'Weather', 'Aircraft']

export function GlossarySheet() {
  const open = useLearn((s) => s.glossary)
  const close = useLearn((s) => s.closeGlossary)
  return (
    <Sheet open={open} title="ATC terms" onClose={close}>
      {open && <Body />}
    </Sheet>
  )
}

function Body() {
  const learn = useInsightSettings((s) => s.learn)
  const update = useInsightSettings((s) => s.update)
  const [query, setQuery] = useState(() => useLearn.getState().glossaryQuery)
  const [expanded, setExpanded] = useState<string | null>(null)
  const results = useMemo(() => searchGlossary(query), [query])
  const q = query.trim()
  const groups = useMemo(() => (q ? [{ title: null, items: results }] : ORDER.map((c) => ({ title: c, items: results.filter((e) => e.category === c) })).filter((g) => g.items.length)), [q, results])

  return (
    <>
      <Group>
        <Row label="Learn mode" hint="Tap underlined terms for a definition">
          <Toggle checked={learn} onChange={(v) => update('learn', v)} label="Learn mode" />
        </Row>
      </Group>
      <label className="relative mt-3 block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-white/45" strokeWidth={2.25} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search, or type a word you heard"
          aria-label="Search ATC terms"
          className="h-11 w-full appearance-none rounded-full bg-white/[0.09] pl-10 pr-4 text-body text-white outline-none ring-1 ring-inset ring-white/[0.06] placeholder:text-white/40 focus:bg-white/[0.12] focus:ring-2 focus:ring-atc-purple/80"
        />
      </label>
      {q.length >= 2 && !results.some((e) => e.term.toLowerCase() === q.toLowerCase()) && <AskAi key={q.toLowerCase()} term={q} exact={results.length > 0} />}
      {groups.map((g) => (
        <section key={g.title ?? 'results'} className="mt-4">
          {g.title && <h3 className="mb-1.5 px-1 text-footnote font-semibold text-white/55">{g.title}</h3>}
          <ul className="overflow-hidden rounded-2xl bg-white/[0.05]">
            {g.items.map((e) => (
              <Item key={e.id} entry={e} open={expanded === e.id} onToggle={() => setExpanded(expanded === e.id ? null : e.id)} />
            ))}
          </ul>
        </section>
      ))}
      <p className="mt-5 px-1 text-caption text-atc-muted">FAA phraseology; ICAO differences noted. Not for flying.</p>
    </>
  )
}

function Item({ entry, open, onToggle }: { entry: GlossaryEntry; open: boolean; onToggle: () => void }) {
  return (
    <li className="border-b border-white/[0.07] last:border-0">
      <button type="button" aria-expanded={open} className="pressable-soft flex min-h-12 w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-white/[0.04]" onClick={onToggle}>
        <span className="min-w-0 flex-1">
          <span className="block text-subhead font-semibold">{entry.term}</span>
          {!open && <span className="mt-0.5 line-clamp-1 block text-footnote text-white/55">{entry.text}</span>}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-white/45 transition-transform duration-[var(--duration-base)] ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="motion-rise px-3.5 pb-3.5">
          <p className="text-subhead leading-snug text-white/85">{entry.text}</p>
          {entry.diagram && <Diagram id={entry.diagram} label={`Diagram: ${entry.term}`} className="mt-3 max-w-sm ring-1 ring-white/[0.08]" />}
        </div>
      )}
    </li>
  )
}

/** A word that isn't in the glossary: ask the AI, on a tap, never as you type. */
function AskAi({ term, exact }: { term: string; exact: boolean }) {
  const ready = useAiReady()
  const [asked, setAsked] = useState(false)
  const answer = useAiTask('explainTerm', asked ? { term: term.toLowerCase() } : null, parseTerm, 30 * 86_400_000)
  if (!ready) return exact ? null : <p className="mt-3 px-1 text-footnote text-white/55">“{term}” isn’t in the built-in glossary.</p>
  if (!asked)
    return (
      <button type="button" className="pressable-soft mt-3 flex w-full items-center gap-2 rounded-2xl bg-atc-card/20 px-3.5 py-3 text-left text-subhead font-semibold ring-1 ring-inset ring-atc-card/50 hover:bg-atc-card/30" onClick={() => setAsked(true)}>
        <Sparkles className="size-4 shrink-0 text-[#C9BCFF]" />
        <span className="min-w-0 flex-1 truncate">Explain “{term}”</span>
      </button>
    )
  return (
    <div className="mt-3 rounded-2xl bg-atc-card/15 px-3.5 py-3 ring-1 ring-inset ring-atc-card/40" aria-live="polite">
      <div className="flex items-center gap-1.5 text-footnote font-semibold text-white/70">
        <AiMark /> {term}
      </div>
      {answer.data ? (
        <p className="mt-1 text-subhead leading-snug text-white/90">{answer.data.explanation}</p>
      ) : answer.loading ? (
        <span className="mt-2 block space-y-1.5" aria-label="Loading">
          <span className="skeleton block h-3.5 w-11/12" />
          <span className="skeleton block h-3.5 w-7/12" />
        </span>
      ) : (
        <p className="mt-1 text-footnote text-white/55">Couldn’t get an explanation just now.</p>
      )}
    </div>
  )
}
