/**
 * The side panel tucked away: a slim rail in the corner instead of nothing.
 * It keeps the things worth a glance while the map has the whole window: the
 * airport sign, the radio's play button with the on-air lamp, and one button
 * per tab carrying the same badges as the tab bar (new calls, alerts, the
 * aircraft count, the weather category). Any tab button opens the panel on
 * that tab.
 */
import { PanelRightOpen } from 'lucide-react'
import { getAirport } from '../../api/airports'
import { usePlayhead } from '../../playback/playheadStore'
import { Lamp } from '../../ui/kit'
import { DOCK_TABS, type DockTab } from '../../ui/layout'
import { Tooltip } from '../../ui/Panel'
import { PanelPlayButton } from './PanelHeader'
import { useLampState } from './panelStore'
import { TabBadgeMark } from './PanelTabs'
import { TAB_ICON, TAB_KEY, TAB_LABEL, tabBadge, useTabSignals } from './tabs'

export function PanelRail({ shown, onOpen }: { shown: boolean; onOpen: (tab?: DockTab) => void }) {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const setPanel = usePlayhead((s) => s.setPanel)
  const airport = getAirport(airportIcao)
  const lamp = useLampState()
  const signals = useTabSignals()

  return (
    <nav
      aria-label="Side panel, collapsed"
      data-hidden={shown ? undefined : ''}
      inert={!shown}
      className="dock-rail glass-sheet grain absolute right-3 top-[max(0.75rem,var(--safe-top))] z-30 flex w-14 flex-col items-center gap-1 rounded-[1.4rem] py-2 shadow-pop ring-1 ring-white/[0.09]"
    >
      <button type="button" aria-label="Show side panel" aria-keyshortcuts="]" className="has-tooltip pressable relative grid size-10 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white" onClick={() => onOpen()}>
        <PanelRightOpen className="size-[18px]" />
        <Tooltip label="Show panel" shortcut="]" side="left" />
      </button>
      <button
        type="button"
        aria-label={`${airport.name}: choose another airport`}
        onClick={() => setPanel('airports')}
        className="on-yellow has-tooltip pressable display-tight relative grid h-8 w-11 place-items-center rounded-[0.6rem] bg-atc-yellow font-display text-[1.05rem] leading-none text-black shadow-[inset_0_-2px_0_rgb(0_0_0/0.14)] hover:bg-atc-yellow-deep"
      >
        {airport.icao}
        <Tooltip label={airport.name} side="left" />
      </button>
      <div className="relative mt-1">
        <PanelPlayButton size="md" />
        {/* The lamp sits on the button's shoulder, where a recording light would. */}
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 grid size-3.5 place-items-center rounded-full bg-atc-panel" title={lamp.label}>
          <Lamp state={lamp.state} color={lamp.color} />
        </span>
      </div>
      <span aria-hidden className="my-1 h-px w-6 bg-white/10" />
      {DOCK_TABS.map((t) => {
        const Icon = TAB_ICON[t]
        const badge = tabBadge(t, false, signals)
        const onAir = t === 'transcripts' && signals.air.speaking
        return (
          <button
            key={t}
            type="button"
            aria-label={`Open ${TAB_LABEL[t]}${badge?.said ?? ''}`}
            aria-keyshortcuts={TAB_KEY[t]}
            className="has-tooltip pressable relative grid size-10 place-items-center rounded-full text-white/75 hover:bg-white/10 hover:text-white"
            onClick={() => onOpen(t)}
          >
            <Icon aria-hidden className="size-[18px] transition-colors duration-[var(--duration-base)]" style={onAir ? { color: signals.air.colors.light } : undefined} strokeWidth={2} />
            {badge && (
              <span className="pointer-events-none absolute right-0 top-0 grid min-h-4 min-w-4 place-items-center rounded-full bg-atc-panel p-0.5">
                <TabBadgeMark badge={badge} />
              </span>
            )}
            <Tooltip label={TAB_LABEL[t]} shortcut={TAB_KEY[t]} side="left" />
          </button>
        )
      })}
    </nav>
  )
}
