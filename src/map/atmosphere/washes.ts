/** Full-screen CSS washes over the map: rain tint, low-visibility haze and the vignette. */
import type { CSSProperties } from 'react'

/**
 * The CSS layers: a cool cast in rain, haze that thickens toward the edges in
 * low visibility, and the vignette with its lighter top (none over aerial
 * photos, which carry their own light).
 */
export function screenWashes(theme: string, fog: number, rain: number, night: number): { tint?: CSSProperties; fog?: CSSProperties; vignette?: CSSProperties } {
  const out: { tint?: CSSProperties; fog?: CSSProperties; vignette?: CSSProperties } = {}
  const paper = theme === 'chart'
  if (rain > 0) out.tint = { background: `rgba(52,86,140,${(0.05 + 0.06 * rain) * (1 - night * 0.4)})` }
  if (fog > 0.02) {
    // Day haze is a pale grey-blue; at night it is the glow of the lights in the murk, much darker.
    const c = paper ? '236,238,242' : night > 0.5 ? '58,68,92' : '148,160,184'
    const edge = (0.2 + 0.5 * fog) * (paper ? 0.8 : 1)
    const veil = 0.04 + 0.16 * fog
    out.fog = {
      background: `radial-gradient(ellipse 75% 65% at 50% 46%, rgba(${c},${veil.toFixed(3)}) 0%, rgba(${c},${(veil + edge * 0.35).toFixed(3)}) 55%, rgba(${c},${(veil + edge).toFixed(3)}) 100%)`,
    }
  }
  if (theme === 'satellite') return out
  if (paper) {
    out.vignette = { background: 'radial-gradient(ellipse 120% 95% at 50% 42%, rgba(20,32,70,0) 62%, rgba(20,32,70,0.1) 100%)' }
    return out
  }
  const glow = 0.075 * (1 - night * 0.55)
  const dark = 0.34 + 0.1 * night
  // The neutral graphite theme gets a neutral sky light; its shade keeps the navy tint of its shadows.
  const sky = theme === 'graphite' ? '196,202,214' : '150,168,214'
  out.vignette = {
    background: [
      // Sky light falling on the top of the map, as in the reference views of New York.
      `radial-gradient(ellipse 130% 60% at 50% -8%, rgba(${sky},${glow.toFixed(3)}) 0%, rgba(${sky},0) 70%)`,
      // A soft darkening toward the corners and, most of all, the bottom.
      `radial-gradient(ellipse 125% 100% at 50% 34%, rgba(3,6,18,0) 58%, rgba(3,6,18,${(dark * 0.55).toFixed(3)}) 84%, rgba(3,6,18,${dark.toFixed(3)}) 100%)`,
    ].join(', '),
  }
  return out
}
