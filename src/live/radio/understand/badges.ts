/**
 * The latest assignment per aircraft, for the small badge beside it on the
 * map ("↑5,000", "HDG 270", "→124.75"). One badge per aircraft: the newest
 * call that gave it something lasting wins (a newer call supersedes an
 * older one), and the badge fades out after about two minutes.
 */
import { badgeLabel, isBadgeWorthy } from './instructions'
import type { StoredUnderstanding } from './store'

export const BADGE_TTL_MS = 120_000
/** The last part of the lifetime, over which the badge fades. */
export const BADGE_FADE_MS = 20_000
/** Most instructions shown in one badge. */
const PER_BADGE = 2

export type Badge = { icao24: string; label: string; at: number; id: string }

export function activeBadges(results: Iterable<Pick<StoredUnderstanding, 'id' | 'at' | 'airport' | 'instructions' | 'targets'>>, airport: string, now: number, ttl = BADGE_TTL_MS): Badge[] {
  const latest = new Map<string, Badge>()
  for (const r of results) {
    if (r.airport !== airport || now - r.at > ttl || r.at > now + 60_000) continue
    const per = new Map<string, string[]>()
    r.instructions.forEach((i, k) => {
      const id = r.targets[k]
      if (!id || !isBadgeWorthy(i)) return
      const list = per.get(id) ?? []
      const label = badgeLabel(i)
      if (list.length < PER_BADGE && !list.includes(label)) list.push(label)
      per.set(id, list)
    })
    for (const [icao24, labels] of per) {
      const prev = latest.get(icao24)
      if (!prev || r.at > prev.at) latest.set(icao24, { icao24, label: labels.join(' · '), at: r.at, id: r.id })
    }
  }
  return [...latest.values()]
}

/** Opacity of a badge `ageMs` old: full, then a fade over the last stretch. */
export function badgeOpacity(ageMs: number, ttl = BADGE_TTL_MS): number {
  if (ageMs >= ttl) return 0
  return Math.max(0, Math.min(1, (ttl - ageMs) / BADGE_FADE_MS))
}
