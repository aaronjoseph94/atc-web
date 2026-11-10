/**
 * Just enough colour maths for the night look: parse the colours the style
 * uses (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`), darken and desaturate them,
 * and blend between two style expressions that differ only in their colours.
 */

export type Rgba = [number, number, number, number]

/** Parse a CSS colour as written in the map style, or `null` if it isn't one. */
export function parseColor(s: string): Rgba | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s)
  if (fn) return [+fn[1], +fn[2], +fn[3], fn[4] == null ? 1 : +fn[4]]
  return null
}

export function formatColor([r, g, b, a]: Rgba): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v)))
  return `rgba(${c(r)},${c(g)},${c(b)},${Math.round(Math.max(0, Math.min(1, a)) * 1000) / 1000})`
}

/** Linear blend from `a` (t = 0) to `b` (t = 1). */
export function mixColor(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
}

/**
 * The night version of a ground colour: darker by `dim` (0..1 of its
 * brightness kept) and with only `sat` of its saturation, pulled a touch
 * towards blue, the way colour drains out of a landscape after dusk.
 */
export function nightShade(color: string, dim: number, sat: number): string {
  const c = parseColor(color)
  if (!c) return color
  const [r, g, b, a] = c
  // Luma-preserving desaturation, then a uniform darkening.
  const y = 0.299 * r + 0.587 * g + 0.114 * b
  const ds = (v: number) => y + (v - y) * sat
  const out: Rgba = [ds(r) * dim, ds(g) * dim, ds(b) * dim * 1.06 + 1.5, a]
  return formatColor(out)
}

/**
 * Blend two style values of the same shape: wherever `day` and `night` hold
 * different colours (or numbers), the result holds the mix at `t`; everything
 * else (operators, property lookups) comes from `day`. Lets a whole zoom-
 * interpolated paint expression fade without restating it.
 */
export function mixValue(day: unknown, night: unknown, t: number): unknown {
  if (t <= 0) return day
  if (typeof day === 'string' && typeof night === 'string') {
    if (day === night) return day
    const a = parseColor(day)
    const b = parseColor(night)
    if (!a || !b) return day
    return t >= 1 ? night : formatColor(mixColor(a, b, t))
  }
  if (typeof day === 'number' && typeof night === 'number') return day + (night - day) * Math.min(1, t)
  if (Array.isArray(day) && Array.isArray(night) && day.length === night.length) return day.map((v, i) => mixValue(v, night[i], t))
  return day
}

/** Do two style values differ anywhere? */
export function differs(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length !== b.length || a.some((v, i) => differs(v, b[i]))
  return a !== b
}
