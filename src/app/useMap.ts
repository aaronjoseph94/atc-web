import type { Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useState } from 'react'
import { mapHandle } from '../live/session'

/**
 * The MapLibre map once it has loaded, for chrome that listens to map events.
 * The map mounts lazily after the chrome, so this waits for it without a
 * per-frame loop.
 */
export function useMap(): MapLibreMap | null {
  const [map, setMap] = useState<MapLibreMap | null>(() => mapHandle.current)
  useEffect(() => {
    if (map && mapHandle.current === map) return
    const id = window.setInterval(() => {
      if (mapHandle.current) {
        setMap(mapHandle.current)
        window.clearInterval(id)
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [map])
  return map
}
