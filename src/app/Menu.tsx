/** The "⋯" menu: a popover under the button, like a native context menu. */
import { CloudRain, FileText, History, Keyboard, Layers, List, Pin, PinOff, Radio, Settings, type LucideIcon } from 'lucide-react'
import { usePlayhead, type Panel } from '../playback/playheadStore'
import { useSettings } from '../settings/settingsStore'
import { useDialog } from '../ui/Panel'
import { usePresence } from '../ui/usePresence'

export function Menu() {
  const open = usePlayhead((s) => s.panel === 'menu')
  const mode = usePlayhead((s) => s.mode)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const setPanel = usePlayhead((s) => s.setPanel)
  const exitPlayback = usePlayhead((s) => s.exitPlayback)
  const setToast = usePlayhead((s) => s.setToast)
  const pinned = useSettings((s) => s.favourites.includes(airportIcao))
  const toggleFavourite = useSettings((s) => s.toggleFavourite)
  const radar = useSettings((s) => s.weatherRadar)
  const update = useSettings((s) => s.update)

  const close = () => setPanel(null)
  const { mounted, closing } = usePresence(open, 140)
  const ref = useDialog(open, close)
  if (!mounted) return null

  const go = (panel: Panel) => () => setPanel(panel)

  return (
    <div className="absolute inset-0 z-50">
      <button type="button" tabIndex={-1} aria-label="Close menu" className="absolute inset-0 cursor-default" onClick={close} />
      <div
        ref={ref}
        role="menu"
        aria-label="Menu"
        tabIndex={-1}
        className={`absolute right-3 top-[calc(max(0.75rem,var(--safe-top))+3.25rem)] w-64 origin-top-right overflow-hidden rounded-2xl bg-[#1b2333]/95 py-1.5 shadow-2xl ring-1 ring-white/15 outline-none backdrop-blur-xl ${
          closing ? 'animate-pop-out' : 'animate-pop'
        }`}
      >
        {mode === 'playback' ? (
          <Item icon={Radio} label="Back to live" onClick={exitPlayback} />
        ) : (
          <Item icon={History} label="Replay" hint="Rewind traffic or play a scene" onClick={go('replay')} />
        )}
        <Item icon={FileText} label={mode === 'playback' ? 'Transcript' : 'Tower log'} onClick={go('transcripts')} />
        <Item icon={List} label="Traffic list" onClick={go('traffic')} />
        <Divider />
        <Item
          icon={pinned ? PinOff : Pin}
          label={pinned ? `Unpin ${airportIcao}` : `Pin ${airportIcao}`}
          onClick={() => {
            toggleFavourite(airportIcao)
            setToast(pinned ? `${airportIcao} unpinned` : `${airportIcao} pinned to the top of the airport list`)
            close()
          }}
        />
        <Item
          icon={CloudRain}
          label={radar ? 'Weather radar off' : 'Weather radar on'}
          onClick={() => {
            update('weatherRadar', !radar)
            close()
          }}
        />
        <Item icon={Layers} label="Map layers" onClick={go('layers')} />
        <Divider />
        <Item icon={Settings} label="Settings" onClick={go('settings')} />
        <Item icon={Keyboard} label="Shortcuts and credits" onClick={go('help')} />
      </div>
    </div>
  )
}

function Divider() {
  return <div className="my-1.5 h-px bg-white/10" role="separator" />
}

function Item({ icon: Icon, label, hint, onClick }: { icon: LucideIcon; label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/10 active:bg-white/15" onClick={onClick}>
      <Icon className="size-[18px] shrink-0 text-white/80" />
      <span className="min-w-0">
        <span className="block text-[15px] font-medium">{label}</span>
        {hint && <span className="block truncate text-xs text-atc-muted">{hint}</span>}
      </span>
    </button>
  )
}
