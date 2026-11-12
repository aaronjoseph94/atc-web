/** The "⋯" menu: a popover under the button, like a native context menu. */
import { BookOpen, CircleHelp, CloudSun, Copyright, FileText, History, List, MessageSquareText, Pin, PinOff, Radio, Settings, Sunrise, type LucideIcon } from 'lucide-react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { OSM_CREDIT } from '../api/credits'
import { openFeedback } from '../feedback/store'
import { openCatchUp } from '../insights/hooks'
import { useLearn } from '../learn/learnStore'
import { usePlayhead, type Panel } from '../playback/playheadStore'
import { useSettings } from '../settings/settingsStore'
import { Kbd, useDialog } from '../ui/Panel'
import { useDockActive } from '../ui/layout'
import { usePresence } from '../ui/usePresence'
import { openCredits } from './helpSection'
import { PANEL_ICON } from './panel/icons'

export function Menu() {
  const open = usePlayhead((s) => s.panel === 'menu')
  const mode = usePlayhead((s) => s.mode)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const setPanel = usePlayhead((s) => s.setPanel)
  const exitPlayback = usePlayhead((s) => s.exitPlayback)
  const setToast = usePlayhead((s) => s.setToast)
  const pinned = useSettings((s) => s.favourites.includes(airportIcao))
  const toggleFavourite = useSettings((s) => s.toggleFavourite)
  const docked = useDockActive()

  const close = () => setPanel(null)
  const { mounted, closing } = usePresence(open, 180)
  const ref = useDialog(open, close)
  if (!mounted) return null

  const go = (panel: Panel) => () => setPanel(panel)

  // A role="menu" is expected to move with the arrow keys (and Home/End), not just Tab.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    if (!items.length) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    let next: number
    if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length
    else if (e.key === 'ArrowUp') next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else return
    e.preventDefault()
    items[next].focus()
  }

  const menu = (
    <div className={`${docked ? 'fixed z-[70]' : 'absolute z-50'} inset-0 ${closing ? 'pointer-events-none' : ''}`}>
      <button type="button" tabIndex={-1} aria-label="Close menu" className="absolute inset-0 cursor-default" onClick={close} />
      <div
        ref={ref}
        role="menu"
        aria-label="Menu"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-closing={closing ? '' : undefined}
        className={`motion-menu absolute w-64 origin-top-right overflow-hidden rounded-2xl glass-pop py-1.5 shadow-pop ring-1 ring-white/[0.12] outline-none ${docked ? 'right-14 top-[calc(max(0.75rem,var(--safe-top))+3.25rem)]' : 'right-3 top-[calc(max(0.75rem,var(--safe-top))+3.4rem)] md:right-4'}`}
      >
        {mode === 'playback' ? (
          <Item icon={Radio} label="Back to live" onClick={exitPlayback} />
        ) : (
          <Item icon={History} label="Replay" shortcut="R" onClick={go('replay')} />
        )}
        {/* Beside the side panel these are its tabs, a few pixels away; the menu doesn't say them again. */}
        {!docked && (
          <>
            <Item icon={FileText} label="Transcript" shortcut="T" onClick={go('transcripts')} />
            <Item icon={List} label="Traffic" shortcut="/" onClick={go('traffic')} />
            <Item icon={CloudSun} label="Weather" shortcut="W" onClick={go('weather')} />
          </>
        )}
        {mode === 'live' && (
          <Item
            icon={Sunrise}
            label="What did I miss?"
            onClick={() => {
              close()
              openCatchUp()
            }}
          />
        )}
        <Item
          icon={BookOpen}
          label="ATC terms"
          onClick={() => {
            close()
            useLearn.getState().openGlossary()
          }}
        />
        <Divider />
        <Item
          icon={pinned ? PinOff : Pin}
          label={pinned ? `Unpin ${airportIcao}` : `Pin ${airportIcao}`}
          onClick={() => {
            toggleFavourite(airportIcao)
            setToast(pinned ? `${airportIcao} unpinned` : `${airportIcao} pinned`)
            close()
          }}
        />
        <Item icon={Settings} label="Settings" onClick={go('settings')} />
        <Item icon={CircleHelp} label="Help" shortcut="?" onClick={go('help')} />
        <Item icon={MessageSquareText} label="Send feedback" onClick={openFeedback} />
        <Item icon={Copyright} label="Map data and credits" onClick={openCredits} />
        {/* The map shows no attribution control; the short credit its data asks for lives here. */}
        <p className="mx-4 mt-1.5 border-t border-white/10 pb-1 pt-2 text-caption2 text-white/40">
          Map data{' '}
          <a href={OSM_CREDIT.href} target="_blank" rel="noreferrer" className="underline decoration-white/20 underline-offset-2 hover:text-white/70">
            {OSM_CREDIT.name}
          </a>
        </p>
      </div>
    </div>
  )
  // Beside the side panel the menu drops from the ⋯ in the panel's tab row, over the panel, so it lives outside the map's box.
  return docked ? createPortal(menu, document.body) : menu
}

function Divider() {
  return <div className="mx-4 my-1.5 h-px bg-white/10" role="separator" />
}

function Item({ icon: Icon, label, shortcut, onClick }: { icon: LucideIcon; label: string; shortcut?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-keyshortcuts={shortcut}
      className="flex min-h-11 w-full items-center gap-3 px-4 text-left transition-colors duration-[var(--duration-fast)] hover:bg-white/[0.08] focus-visible:bg-white/[0.08] focus-visible:-outline-offset-2 active:bg-white/[0.14]"
      onClick={onClick}
    >
      <Icon aria-hidden {...PANEL_ICON} className={`${PANEL_ICON.className} text-white/60`} />
      <span className="min-w-0 flex-1 truncate text-subhead font-medium">{label}</span>
      {shortcut && <Kbd className="hidden [@media(hover:hover)]:inline-grid">{shortcut}</Kbd>}
    </button>
  )
}
