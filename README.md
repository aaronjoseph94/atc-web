# ATC Web

Live airport traffic on a dark aviation map, with a synced tower-audio playback mode (karaoke transcript + replayed aircraft tracks). Installable PWA, responsive from phone to desktop, runs entirely on free services.

**Live:** https://atc-web-62t.pages.dev

## Features

- **Live traffic** for 21 airports (16 US, 5 Canada) from free ADS-B feeds, smoothly interpolated between polls.
- **Aviation map theme** — the free OpenFreeMap basemap is recoloured at runtime to navy land, deep-blue water and green airfield infields.
- **Real aircraft silhouettes** (SDF icons, heading-rotated), purple glow trail for the selected aircraft, pulsing halo for whoever is transmitting.
- **Playback mode** — a bundled demo clip drives audio, karaoke-style transcript, and aircraft movement from one clock; scrub or tap a transcript line to seek.
- **Flight sheet** — tapping a plane opens a plain-English card: airline and flight number, what the aircraft is doing (parked, taxiing, climbing…), speed in mph, altitude with a familiar comparison, and a summary of the latest radio call.
- **Radio explanations** — a built-in phrasebook translates calls ("hold short 27C" → "stop before runway 27C"). Set `AI_API_KEY` (OpenRouter or Claude) and the same card is written by the model instead. See Settings → Radio explanations.
- **Settings page** — default airport, poll interval, labels, trail length, map theme, reduced motion, units — persisted locally — plus a **backend status** panel reporting which feed answered, latency and edge region.

## Stack

| Layer | Choice |
| --- | --- |
| UI | React 19, TypeScript 7, Vite 8, Tailwind 4, Lucide icons |
| Map | MapLibre GL 6 via `react-map-gl`, OpenFreeMap tiles (no token) |
| State | Zustand (playhead + persisted settings), TanStack Query (polling) |
| Backend | Cloudflare Pages Functions (`functions/api/*`), edge cache |
| Data | adsb.lol → adsb.fi → OpenSky, tried in order, normalized to one shape |
| Tooling | oxlint, Vitest + Testing Library, GitHub Actions CI, Wrangler |

No paid APIs, fonts, icon packs or tile services are used.

## Project layout

```
functions/api/        Cloudflare Pages Functions: aircraft, health, stations, clips/[id], summarize
public/clips/         Bundled demo clip (CC0 synthetic audio + manifest)
public/sw.js          Service worker: caches tiles/glyphs/clips, never the shell or API
scripts/              Vite dev middleware mirroring the Functions; asset generator
src/api/              Types, airport catalog, providers + normalizers, browser client
src/app/              Shell, top chrome, menu, airport picker, transcripts
src/map/              MapView, AircraftLayer (rAF-driven GeoJSON), theme, interpolation
src/playback/         Zustand playhead store, audio clock, track/cue interpolation
src/settings/         Persisted settings store + Settings page
src/station/          Yellow station bar + waveform
src/transcript/       Karaoke overlay
src/ui/               Shared Sheet / FullPanel primitives
```

### How the pieces fit

- `usePlayhead` is the single clock. `AudioEngine` writes `tMs` from the `<audio>` element during playback; the map, karaoke overlay and station bar all read it.
- `MapView` polls `/api/aircraft` and pushes snapshots into a `LivePositionBuffer`. `AircraftLayer` runs one `requestAnimationFrame` loop that samples the buffer and writes GeoJSON straight into MapLibre — React never re-renders per frame.
- `functions/api/aircraft.ts` tries each provider in `src/api/aircraftHandler.ts` and caches the result at the edge for a few seconds, so all clients share one upstream request per airport.

## Develop

```bash
npm install
npm run dev          # Vite + local /api middleware (no Wrangler needed)
```

```bash
npm run lint         # oxlint
npm run typecheck    # tsc -b (app, node scripts, functions)
npm test             # vitest (unit + jsdom component tests)
npm run build        # tsc -b && vite build
npm run check        # all of the above
```

`npm run pages` serves the production bundle through Wrangler with real Pages Functions on http://localhost:8788.

## Deploy (Cloudflare Pages, free tier)

```bash
npx wrangler login
npx wrangler pages project create atc-web --production-branch master   # once
npm run deploy
```

Functions under `functions/` are picked up automatically; no environment variables or secrets are required.

## Data sources & credits

- Traffic: [adsb.lol](https://adsb.lol), [adsb.fi](https://adsb.fi), [OpenSky Network](https://opensky-network.org) — community ADS-B feeds, no keys.
- Basemap: [OpenFreeMap](https://openfreemap.org) © [OpenMapTiles](https://openmaptiles.org), data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Font: Outfit (Google Fonts, OFL). Icons: Lucide (ISC). Aircraft silhouette: self-authored, CC0.
- Demo audio is a synthetic CC0 tone; no third-party ATC recordings are redistributed. LiveATC, ATCO2 and ATCOSIM archives are not redistributable, so live mode shows positions only.
- Airport frequencies and runway ends: [OurAirports](https://ourairports.com/data/) (public domain), snapshotted in `src/api/airportData.json`. Refresh with `npm run data:airports`.

## AI summaries (optional)

`POST /api/summarize` explains a flight's recent radio calls. With no key it uses the built-in phrasebook. To use your own account, set these as Pages environment variables (or in the shell before `npm run dev`):

| Variable | Example |
| --- | --- |
| `AI_API_KEY` | your OpenRouter or Anthropic key |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` (default) or `https://api.anthropic.com` |
| `AI_MODEL` | `anthropic/claude-3.5-haiku` or `claude-3-5-haiku-latest` |

The key never reaches the browser. Identical requests are cached at the edge.
