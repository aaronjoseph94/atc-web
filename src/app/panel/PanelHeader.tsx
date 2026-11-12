/**
 * The side panel's top row: the tabs, then the app menu and the button that
 * tucks the panel away. Nothing else: the airport, the channel, the weather
 * and play/pause are on the yellow station bar under the map, and saying them
 * twice only made both harder to read.
 *
 * The row stays put while a flight's page is open below it, so the tabs are
 * always one click away (no tab reads as chosen then).
 */
import { MoreHorizontal, PanelRightClose } from 'lucide-react'
import { usePlayhead } from '../../playback/playheadStore'
import type { DockTab } from '../../ui/layout'
import { Tooltip } from '../../ui/Panel'
import { PANEL_ICON, PANEL_ICON_BUTTON } from './icons'
import { PanelTabs } from './PanelTabs'

export function PanelHeader({ tab, flightShown, onPick, onCollapse }: { tab: DockTab; flightShown: boolean; onPick: (t: DockTab) => void; onCollapse: () => void }) {
  return (
    <header className="flex shrink-0 items-center gap-1 py-3 pl-3 pr-2">
      <PanelTabs tab={tab} flightShown={flightShown} onPick={onPick} />
      <PanelMenuButton />
      <button type="button" aria-label="Hide side panel" aria-keyshortcuts="]" className={PANEL_ICON_BUTTON} onClick={onCollapse}>
        <PanelRightClose aria-hidden {...PANEL_ICON} />
        <Tooltip label="Hide panel" shortcut="]" side="left" />
      </button>
    </header>
  )
}

/** The app menu (Replay, Settings, Help…); it drops from this button, over the panel. */
function PanelMenuButton() {
  const open = usePlayhead((s) => s.panel === 'menu')
  const setPanel = usePlayhead((s) => s.setPanel)
  return (
    <button
      type="button"
      aria-label="Menu"
      aria-keyshortcuts="M"
      aria-haspopup="menu"
      aria-expanded={open}
      data-menu-anchor=""
      className={`${PANEL_ICON_BUTTON} ${open ? '!bg-white/[0.14] !text-white' : ''}`}
      onClick={() => setPanel(open ? null : 'menu')}
    >
      <MoreHorizontal aria-hidden {...PANEL_ICON} />
      {!open && <Tooltip label="Menu" shortcut="M" side="bottom" />}
    </button>
  )
}
