/**
 * Which aircraft wear a star on their map tag: the rare ones the spotter has
 * found. A plain set with no imports, so the tag drawing code can read it
 * every frame without pulling the spotting logic in.
 */
const starred = new Set<string>()

export function isStarred(icao24: string): boolean {
  return starred.size > 0 && starred.has(icao24)
}

/** Replace the starred set (empty to hide every star). */
export function setStarred(ids: Iterable<string>) {
  starred.clear()
  for (const id of ids) starred.add(id)
}
