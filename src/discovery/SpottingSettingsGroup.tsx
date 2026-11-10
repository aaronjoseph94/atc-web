/**
 * Settings > Spotting: the rare-aircraft toast and map star switches. And,
 * folded away under Data and diagnostics for the owner, a copy of the types
 * and airline codes the app couldn't name (input for
 * `scripts/ai-cleanup.mjs --seen`).
 */
import { useState } from 'react'
import { usePlayhead } from '../playback/playheadStore'
import { Group, Row, SectionLabel, Toggle } from '../ui/Panel'
import { useSpotSettings } from './spotSettings'
import { exportUnknowns, useUnknowns } from './unknowns'

export function SpottingSettingsGroup() {
  const s = useSpotSettings()
  return (
    <>
      <SectionLabel>Spotting</SectionLabel>
      <Group>
        <Row label="Rare aircraft alerts" hint="A short note when something unusual comes within range">
          <Toggle checked={s.toasts} onChange={(v) => s.update('toasts', v)} label="Rare aircraft alerts" />
        </Row>
        <Row label="Star rare aircraft on the map">
          <Toggle checked={s.stars} onChange={(v) => s.update('stars', v)} label="Star rare aircraft on the map" />
        </Row>
      </Group>
    </>
  )
}

/** "Not recognised yet … Copy": shown only once something went unrecognised. */
export function UnrecognisedDataGroup() {
  const unknowns = useUnknowns()
  const setToast = usePlayhead((st) => st.setToast)
  const [copied, setCopied] = useState(false)
  const nTypes = Object.keys(unknowns.types).length
  const nPrefixes = Object.keys(unknowns.prefixes).length
  if (nTypes + nPrefixes === 0) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportUnknowns(unknowns), null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setToast({ message: 'Couldn’t copy to the clipboard in this browser.', tone: 'error' })
    }
  }

  const parts = [nTypes ? `${nTypes} aircraft ${nTypes === 1 ? 'type' : 'types'}` : '', nPrefixes ? `${nPrefixes} airline ${nPrefixes === 1 ? 'code' : 'codes'}` : ''].filter(Boolean)
  return (
    <Group>
      <Row label="Not recognised yet" hint={`${parts.join(', ')} seen without a name, for the data cleanup script`}>
        <button type="button" className="pressable rounded-full bg-white/10 px-3.5 py-1.5 text-footnote font-semibold hover:bg-white/[0.18]" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </Row>
    </Group>
  )
}
