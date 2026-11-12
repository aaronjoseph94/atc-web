import { ArrowLeftRight, OctagonX, RotateCcw, Siren, Split, type LucideIcon } from 'lucide-react'
import type { AlertKind } from './insightSettings'

/** Icon and colour per kind of alert, shared with the side panel's overview. */
export const ALERT_STYLE: Record<AlertKind, { icon: LucideIcon; color: string }> = {
  emergency: { icon: Siren, color: '#FF3B30' },
  goaround: { icon: RotateCcw, color: '#FF9F0A' },
  rto: { icon: OctagonX, color: '#FF6B4A' },
  runway: { icon: ArrowLeftRight, color: '#64D2FF' },
  diversion: { icon: Split, color: '#BF5AF2' },
}
