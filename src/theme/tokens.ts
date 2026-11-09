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

/** OpenFreeMap dark style — free, no token. */
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'

export const ORD_CENTER = {
  longitude: -87.9048,
  latitude: 41.9786,
  zoom: 13.2,
  pitch: 0,
  bearing: -10,
} as const
