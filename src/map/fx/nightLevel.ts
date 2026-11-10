/**
 * How dark it is (0 day … 1 night), for the aircraft lights. Uses the same
 * sun model, setting and fade as the map's day/night lighting
 * (`lighting/LightingLayer.tsx`), so the lights come on with the ground
 * going dark. Read every frame; it only looks at the sun a few times a minute.
 */
import { usePlayhead } from '../../playback/playheadStore'
import { useSettings } from '../../settings/settingsStore'
import { fadeValue, startFade, type Fade } from '../lighting/fade'
import { nightFactor, sunElevation } from '../lighting/sun'

const SUN_CHECK_MS = 15_000

export class NightLevel {
  private fade: Fade | null = null
  private target = -1
  private checkedAt = -Infinity
  private mode = ''

  /** Night level at `now` (a `performance.now()` time) for a map centred at `lon`/`lat`. */
  value(now: number, lon: number, lat: number): number {
    const lighting = useSettings.getState().lighting
    const s = usePlayhead.getState()
    const sceneKey = `${lighting}|${s.mode}|${s.clip?.startedAt ?? ''}`
    if (sceneKey !== this.mode || now - this.checkedAt > SUN_CHECK_MS) {
      this.checkedAt = now
      const first = this.target < 0
      this.mode = sceneKey
      const sceneMs = s.mode === 'playback' && s.clip?.startedAt != null ? s.clip.startedAt + s.tMs : Date.now()
      const target = lighting === 'night' ? 1 : lighting === 'day' ? 0 : nightFactor(sunElevation(sceneMs, lat, lon))
      if (first) this.fade = startFade(target, target, now)
      else if (Math.abs(target - this.target) > 1e-3) this.fade = startFade(this.fade ? fadeValue(this.fade, now) : target, target, now)
      this.target = target
    }
    return this.fade ? fadeValue(this.fade, now) : 0
  }
}
