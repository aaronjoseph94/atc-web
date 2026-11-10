/**
 * Settings > Data and diagnostics: the performance mode (Auto, or a tier
 * held by hand) and what is in effect right now with the measured frame
 * time, so "it feels slow" can be checked against a number.
 */
import { Group, Segmented } from '../ui/Panel'
import { useSettings } from '../settings/settingsStore'
import { usePerf } from './governor'
import type { PerformanceMode, QualityTier } from './quality'

const NAME: Record<QualityTier, string> = { smooth: 'Smooth', balanced: 'Balanced', beautiful: 'Beautiful' }

const OPTIONS: [PerformanceMode, string][] = [
  ['auto', 'Auto'],
  ['smooth', 'Smooth'],
  ['balanced', 'Balanced'],
  ['beautiful', 'Beautiful'],
]

/** What each choice trades, in a sentence. */
const HINT: Record<PerformanceMode, string> = {
  auto: 'Picks the richest look this device keeps smooth, and steps down when frames slow.',
  smooth: 'Fewest effects and a lighter map canvas, for the steadiest frame rate.',
  balanced: 'Most effects, a slightly lighter canvas on high-density screens.',
  beautiful: 'Every effect at full resolution.',
}

export function PerformanceSettings() {
  const mode = useSettings((s) => s.performance)
  const update = useSettings((s) => s.update)
  const tier = usePerf((s) => s.tier)
  const frameMs = usePerf((s) => s.frameMs)
  const fps = frameMs ? Math.round(1000 / frameMs) : null

  return (
    <Group className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-subhead font-medium">Performance</span>
        <span className="text-footnote tabular-nums text-atc-muted" data-testid="quality-tier">
          Now {NAME[tier]}
          {fps != null && ` · ${fps} fps`}
        </span>
      </div>
      <div className="mt-2.5">
        <Segmented label="Performance mode" value={mode} options={OPTIONS} onChange={(v) => update('performance', v)} />
      </div>
      <p className="mt-2 text-footnote text-atc-muted">{HINT[mode] ?? HINT.auto}</p>
    </Group>
  )
}
