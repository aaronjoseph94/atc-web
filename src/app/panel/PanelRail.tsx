/**
 * The side panel tucked away: a slim rail in the corner instead of nothing.
 * One button brings the panel back; one per tab opens it on that tab, with
 * the same badges as the tab bar (new calls, alerts, the aircraft count).
 * The airport, the channel and play/pause stay on the station bar, as ever.
 */
import { MoreHorizontal, PanelRightOpen } from 'lucide-react'
import { usePlayhead } from '../../playback/playheadStore'
import { DOCK_TABS, type DockTab } from '../../ui/layout'
import { Tooltip } from '../../ui/Panel'
import { PANEL_ICON } from './icons'
import { TabBadgeMark } from './PanelTabs'
import { TAB_ICON, TAB_KEY, TAB_LABEL, tabBadge, useTabSignals } from './tabs'

const RAIL_BUTTON = 'has-tooltip pressable relative grid size-10 place-items-center rounded-full text-white/60 transition-colors duration-[var(--duration-fast)] hover:bg-white/10 hover:text-white'

export function PanelRail({ shown, onOpen }: { shown: boolean; onOpen: (tab?: DockTab) => void }) {
  const signals = useTabSignals()
  const menuOpen = usePlayhead((s) => s.panel === 'menu')
  const setPanel = usePlayhead((s) => s.setPanel)

  return (
    <nav
      aria-label="Side panel, collapsed"
      data-hidden={shown ? undefined : ''}
      inert={!shown}
      className="dock-rail glass-sheet grain absolute right-3 top-[max(0.75rem,var(--safe-top))] z-30 flex w-14 flex-col items-center gap-0.5 rounded-[1.4rem] py-2 shadow-pop ring-1 ring-white/[0.09]"
    >
      <button type="button" aria-label="Show side panel" aria-keyshortcuts="]" className={RAIL_BUTTON} onClick={() => onOpen()}>
        <PanelRightOpen aria-hidden {...PANEL_ICON} />
        <Tooltip label="Show panel" shortcut="]" side="left" />
      </button>
      <span aria-hidden className="my-1 h-px w-6 bg-white/10" />
      {DOCK_TABS.map((t) => {
        const Icon = TAB_ICON[t]
        const badge = tabBadge(t, false, signals)
        const onAir = t === 'transcripts' && signals.air.speaking
        return (
          <button key={t} type="button" aria-label={`Open ${TAB_LABEL[t]}${badge?.said ?? ''}`} aria-keyshortcuts={TAB_KEY[t]} className={RAIL_BUTTON} onClick={() => onOpen(t)}>
            <Icon aria-hidden {...PANEL_ICON} style={onAir ? { color: signals.air.colors.light } : undefined} />
            {badge && (
              <span className="pointer-events-none absolute right-0.5 top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-atc-panel p-0.5">
                <TabBadgeMark badge={badge} />
              </span>
            )}
            <Tooltip label={TAB_LABEL[t]} shortcut={TAB_KEY[t]} side="left" />
          </button>
        )
      })}
      {shown && <span aria-hidden className="my-1 h-px w-6 bg-white/10" />}
      {shown && <button
        type="button"
        aria-label="Menu"
        aria-keyshortcuts="M"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`${RAIL_BUTTON} ${menuOpen ? 'bg-white/15 text-white' : ''}`}
        onClick={() => setPanel(menuOpen ? null : 'menu')}
      >
        <MoreHorizontal aria-hidden {...PANEL_ICON} />
        {!menuOpen && <Tooltip label="Menu" shortcut="M" side="left" />}
      </button>}
    </nav>
  )
}
