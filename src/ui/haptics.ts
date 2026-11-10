/**
 * Light haptic ticks. Android browsers have `navigator.vibrate`. iPhone
 * Safari has no vibration API, but since iOS 18 toggling an
 * `<input type="checkbox" switch>` plays the system's selection tick, so a
 * hidden switch is toggled instead. Desktop browsers have neither and stay
 * silent (and the setting is hidden there).
 *
 * Every tick respects the "Haptics" setting and reduced motion. iOS only
 * plays the tick while handling a user gesture, so ticks fired by the radio
 * on their own are felt on Android only; that is a platform limit, and fine.
 */
import { useSettings } from '../settings/settingsStore'
import { reducedMotion } from './motion'

/** `tick`: a detent or snap. `select`: something chosen. `call`: the watched flight was called on the radio. */
export type HapticKind = 'tick' | 'select' | 'call'

/** Vibration patterns per kind for Android, in ms (on, off, on…). Kept short: a tap, not a buzz. */
export const PATTERN: Record<HapticKind, number | number[]> = { tick: 6, select: 12, call: [14, 70, 14] }

/** Taps on iOS per kind; the switch trick has one strength, so a call gets two. */
const IOS_TAPS: Record<HapticKind, number> = { tick: 1, select: 1, call: 2 }

type Env = { vibrate: boolean; userAgent: string; platform: string; maxTouchPoints: number }

function env(): Env {
  if (typeof navigator === 'undefined') return { vibrate: false, userAgent: '', platform: '', maxTouchPoints: 0 }
  return { vibrate: typeof navigator.vibrate === 'function', userAgent: navigator.userAgent, platform: navigator.platform ?? '', maxTouchPoints: navigator.maxTouchPoints ?? 0 }
}

/** iOS / iPadOS 18 or later, where the switch trick works. iPads report themselves as Macs with touch. */
export function isIosHaptic(e: Env = env()): boolean {
  const ios = /iP(hone|od|ad)/.test(e.platform) || /iP(hone|od|ad)/.test(e.userAgent) || (e.platform === 'MacIntel' && e.maxTouchPoints > 1)
  if (!ios) return false
  const m = /OS (\d+)_/.exec(e.userAgent) ?? /Version\/(\d+)/.exec(e.userAgent)
  return !!m && Number(m[1]) >= 18
}

/** Can this device play a haptic tick at all? Decides whether the setting is shown. */
export function supportsHaptics(e: Env = env()): boolean {
  // Desktop Chrome has `vibrate` but no motor; a fine pointer and no touch gives it away.
  if (e.vibrate && e.maxTouchPoints > 0) return true
  return isIosHaptic(e)
}

let iosSwitch: HTMLLabelElement | null = null

/** The hidden iOS switch, made on first use. A label click toggles the switch, which plays the tick. */
function iosLabel(): HTMLLabelElement | null {
  if (iosSwitch?.isConnected) return iosSwitch
  if (typeof document === 'undefined') return null
  const label = document.createElement('label')
  label.setAttribute('aria-hidden', 'true')
  label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '')
  input.tabIndex = -1
  label.append(input)
  document.body.append(label)
  iosSwitch = label
  return label
}

/** Play a haptic tick, if the device can, the user wants them and motion isn't reduced. */
export function haptic(kind: HapticKind = 'tick') {
  if (!useSettings.getState().haptics || reducedMotion()) return
  const e = env()
  try {
    if (e.vibrate && e.maxTouchPoints > 0) {
      navigator.vibrate(PATTERN[kind])
      return
    }
    if (isIosHaptic(e)) {
      const label = iosLabel()
      if (!label) return
      label.click()
      if (IOS_TAPS[kind] > 1) window.setTimeout(() => label.click(), 90)
    }
  } catch {
    // Some browsers refuse without a user gesture; a missing tick is fine.
  }
}
