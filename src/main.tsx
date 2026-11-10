import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
// Already part of the app bundle; imported here only for the debug handles below.
import * as liveSession from './live/session'
import { useRadio } from './live/radio/radioStore'
import { ingest } from './live/radio/transcriber'
import { usePlayhead } from './playback/playheadStore'
import { useSettings } from './settings/settingsStore'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The end-to-end tests (e2e/) set this flag before the app loads, so the
// production build they run against exposes the same debug handles as dev.
const e2e = Reflect.get(window, '__ATC_E2E__') === true

// Register the tile/clip caching service worker in production builds only, so
// local development never serves stale assets. Tests skip it: it would answer
// requests the tests stub out.
if (import.meta.env.PROD && !e2e && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// Handles for poking at the app from the console and from browser tests (development and e2e runs only).
if (import.meta.env.DEV || e2e) {
  Object.assign(window, { __atc: { playhead: usePlayhead, settings: useSettings, radio: useRadio, ingest, ...liveSession } })
}
