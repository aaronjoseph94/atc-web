/**
 * Design tokens shared between CSS (via `@theme` in index.css) and MapLibre
 * paint expressions, which can't read CSS variables.
 */
export const TOKENS = {
  yellow: '#F5C518',
  purple: '#7C5CFC',
  live: '#EF4444',
  mapBg: '#0B1220',
  plane: '#FFFFFF',
  planeSelected: '#F5C518',
  trail: '#7C5CFC',
  labelBg: 'rgba(20,24,32,0.88)',
} as const

/** OpenFreeMap dark style — free, no token. Recoloured at runtime by `mapTheme.ts`. */
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'
