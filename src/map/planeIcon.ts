import type { Map as MapLibreMap } from 'maplibre-gl'

/**
 * Self-authored CC0 top-down airliner silhouette (nose-up / north), drawn
 * with canvas paths and registered as an SDF image so MapLibre can tint it
 * (`icon-color`) and outline it (`icon-halo-*`) per feature.
 */
export function ensurePlaneIcon(map: MapLibreMap, id = 'plane-icon') {
  if (map.hasImage(id)) return

  const size = 96
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  ctx.translate(size / 2, size / 2)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()

  // Nose + fuselage
  ctx.moveTo(0, -34)
  ctx.bezierCurveTo(3.2, -34, 4.2, -18, 4.2, -6)
  // Starboard wing
  ctx.lineTo(28, 4)
  ctx.lineTo(30, 9)
  ctx.lineTo(4.2, 4)
  // Starboard engine nacelle hint
  ctx.lineTo(4.2, 10)
  ctx.lineTo(12, 14)
  ctx.lineTo(11, 17)
  ctx.lineTo(4.2, 14)
  // Tailplane starboard
  ctx.lineTo(4.2, 22)
  ctx.lineTo(14, 28)
  ctx.lineTo(13, 31)
  ctx.lineTo(0, 26)
  // Tailplane port
  ctx.lineTo(-13, 31)
  ctx.lineTo(-14, 28)
  ctx.lineTo(-4.2, 22)
  // Port engine
  ctx.lineTo(-4.2, 14)
  ctx.lineTo(-11, 17)
  ctx.lineTo(-12, 14)
  ctx.lineTo(-4.2, 10)
  // Port wing
  ctx.lineTo(-4.2, 4)
  ctx.lineTo(-30, 9)
  ctx.lineTo(-28, 4)
  ctx.lineTo(-4.2, -6)
  ctx.bezierCurveTo(-4.2, -18, -3.2, -34, 0, -34)
  ctx.closePath()
  ctx.fill()

  // Vertical stabilizer tip (darker via overdraw for silhouette detail)
  ctx.beginPath()
  ctx.moveTo(0, 18)
  ctx.lineTo(2.5, 32)
  ctx.lineTo(0, 30)
  ctx.lineTo(-2.5, 32)
  ctx.closePath()
  ctx.fill()

  const data = ctx.getImageData(0, 0, size, size)
  map.addImage(id, data, { sdf: true })
}
