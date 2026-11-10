import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the tile/clip caching service worker in production builds only, so
// local development never serves stale assets.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// Handles for poking at the app from the console and from browser tests (development only).
if (import.meta.env.DEV) {
  void Promise.all([import('./playback/playheadStore'), import('./live/session'), import('./settings/settingsStore')]).then(([p, l, s]) => {
    Object.assign(window, { __atc: { playhead: p.usePlayhead, settings: s.useSettings, ...l } })
  })
}
