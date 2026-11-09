/**
 * MapLibre 6 loads its tile-parsing web worker from a sibling file
 * (`maplibre-gl-worker.mjs`) resolved against `import.meta.url`. After
 * bundling, that sibling doesn't exist, the worker 404s, tiles never parse and
 * the map stays black. Importing the worker through Vite's `?url` gives us a
 * hashed, served asset we can hand to MapLibre explicitly.
 *
 * Import this module before creating any `Map`.
 */
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

setWorkerUrl(workerUrl)
