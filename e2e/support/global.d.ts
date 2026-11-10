/** The debug handles `src/main.tsx` puts on `window` in dev builds and e2e runs. */
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { useRadio } from '../../src/live/radio/radioStore'
import type { ingest } from '../../src/live/radio/transcriber'
import type { LivePositionBuffer } from '../../src/map/livePositions'
import type { usePlayhead } from '../../src/playback/playheadStore'
import type { useSettings } from '../../src/settings/settingsStore'

declare global {
  interface Window {
    __ATC_E2E__?: boolean
    __atc: {
      playhead: typeof usePlayhead
      settings: typeof useSettings
      radio: typeof useRadio
      ingest: typeof ingest
      liveBuffer: LivePositionBuffer
      mapHandle: { current: MapLibreMap | null; home: (() => void) | null }
    }
  }
}

export {}
