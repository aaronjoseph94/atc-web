/**
 * How dark it is (0 day … 1 night), for the aircraft lights: the sun at the
 * airport (or the replay's clock). Read every frame; it only looks at the sun
 * a few times a minute.
 */
import { usePlayhead } from '../../playback/playheadStore'
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
    const s = usePlayhead.getState()
    const sceneKey = `${s.mode}|${s.clip?.startedAt ?? ''}`
    if (sceneKey !== this.mode || now - this.checkedAt > SUN_CHECK_MS) {
      this.checkedAt = now
      const first = this.target < 0
      this.mode = sceneKey
      const sceneMs = s.mode === 'playback' && s.clip?.startedAt != null ? s.clip.startedAt + s.tMs : Date.now()
      const target = nightFactor(sunElevation(sceneMs, lat, lon))
      if (first) this.fade = startFade(target, target, now)
      else if (Math.abs(target - this.target) > 1e-3) this.fade = startFade(this.fade ? fadeValue(this.fade, now) : target, target, now)
      this.target = target
    }
    return this.fade ? fadeValue(this.fade, now) : 0
  }
}
