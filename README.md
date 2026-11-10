# ATC Web

Live airport traffic on a painted airfield map: real runway markings, every controller frequency, a tower log of takeoffs and landings, weather with the actual ATIS, and tower-radio replays. Installable PWA, built for phones and desktops alike, and it runs entirely on free services.

**Live:** https://atc-web-62t.pages.dev

## Features

**Map**
- **Painted airfield.** Runway pavement and FAA-standard markings (threshold stripes, designators, centreline, aiming points, touchdown-zone bars, displaced-threshold arrows) are generated from surveyed runway ends, so they stay sharp at any zoom. Taxiway centrelines, holding-position bars, taxiway signs and gate numbers come from OpenStreetMap.
- **Four looks:** night (navy with green infield), graphite, USGS aerial photos, and the FAA's VFR charts. Plus an optional NEXRAD weather-radar overlay. The US-government layers cover US airports.
- **Aircraft** drawn by airframe class (narrow-body, wide-body, four-engine, regional jet, turboprop, light, helicopter, ground vehicle), with shadows that grow with height, a wake behind everything airborne, and a controller-style data block (`045↑ B738` = 4,500 ft, climbing, 737-800).

**Live traffic**
- 37 airports (29 US, 8 Canada) from free ADS-B feeds, smoothly predicted between polls and faded in and out at the edge of coverage.
- **Live radio.** Press play on the station bar (or pick a channel) to hear it live from LiveATC.net, where a feed carries that frequency (`src/api/liveatcFeeds.ts`). Each transmission is cut out of the stream in the browser, transcribed by Whisper on Cloudflare Workers AI (`/api/transcribe`), shown as a caption, in the transcript and in the flight's conversation, and the aircraft it names is highlighted while the automatic camera glides in and back out.
- **Tower log.** Takeoffs, landings, go-arounds and line-ups are detected from positions, matched to a runway, and shown as captions when the radio is off. These are stated as facts, not quotes.
- **Automatic map.** The camera moves to whoever is in the news and drifts back; drag the map to take over, tap "Back to automatic map" to hand it back.
- **Flight card.** Tap a plane: the camera locks on (TRACK), and a card shows its scheduled route, speed and altitude trends, and what it is doing ("On final for runway 27R, 2.2 nm out"). Drag it up for a drawing of the aircraft type with its facts (engines, size, seats, range), route progress and every number.
- **Channel switcher.** Every published position at the airport: one tower per runway, each ground sector, approach, departure, clearance, ATIS.
- **Weather.** Decoded METAR, a wind rose against the runways, head- and cross-wind per runway, and the real digital ATIS, which can be read aloud.
- **Traffic list** with search by flight, airline, type or tail number.

**Replay**
- **Rewind.** The app records the traffic it shows; scrub back through the last 45 minutes at up to 8×, with logged events as markers on the timeline.
- **Recorded scenes.** Three scripted tower exchanges (O'Hare departures, a go-around at JFK, parallel arrivals at SFO) with synthesized radio audio, word-by-word subtitles, a chat-style transcript per flight, and aircraft moving on the real runways.
- **Radio explanations.** A built-in phrasebook translates calls ("hold short 27C" → "stop before runway 27C"). Set `AI_API_KEY` and a model writes the summary instead.

**Everywhere**
- Keyboard shortcuts (`?` lists them), sheets you can drag or pull down to close, tap a runway for its details, press and hold (or right-click) to centre the map, deep links per airport (`/#/JFK`), pinned and recent airports, "near me", units, reduced motion.

## Stack

| Layer | Choice |
| --- | --- |
| UI | React 19, TypeScript 7, Vite 8, Tailwind 4, Lucide icons |
| Map | MapLibre GL 6 via `react-map-gl`; own style on OpenFreeMap vector tiles (no token) |
| State | Zustand (playhead + persisted settings), TanStack Query (polling) |
| Backend | Cloudflare Pages Functions (`functions/api/*`), edge cache |
| Data | adsb.fi + adsb.lol merged, OpenSky last resort (health-aware failover); adsbdb + hexdb; aviationweather.gov + NOAA; FAA NASR. Every source and its terms: [docs/data-sources.md](docs/data-sources.md) |
| Tooling | oxlint, Vitest, Wrangler; Python + Piper for the replay clips |

No paid APIs, fonts, icon packs or tile services are used, and no accounts or keys are needed.

## Project layout

```
functions/api/        Cloudflare Pages Functions: aircraft, weather, flight, health, stations, clips/[id], summarize
public/clips/         Replay scenes: audio + manifest per clip, and index.json
public/sw.js          Service worker: caches tiles/glyphs/imagery/clips, never the shell or API
scripts/              Vite dev middleware mirroring the Functions; airport data fetcher
scripts/clips/        Clip generator: scenarios, flight kinematics, speech synthesis, radio effect, verifier
src/api/              Types, airport catalog, providers + normalizers, browser client
src/app/              Shell, top bar, map controls, menu and panels
src/flight/           Flight card and full view, plain-language phrasebook
src/live/             Tower-log event detection, session recorder
src/map/              Map style, airport diagram generator, aircraft layer, camera, position smoothing
src/playback/         Playhead store, audio clock, timeline, track interpolation
src/station/          Yellow station bar, channel switcher, waveform
src/weather/          Weather panel, ATIS decoding, runway wind
src/ui/               Shared sheets, drag and presence helpers
```

### How the pieces fit

- `usePlayhead` is the single clock and UI state. In a scene the `<audio>` element writes `tMs`; in a rewind a timer does. The map, subtitles and station bar all read it.
- `MapView` polls `/api/aircraft` and pushes each snapshot into the `LivePositionBuffer` (smoothing), the `LiveRecorder` (rewind) and `detectEvents` (tower log). `AircraftLayer` runs one `requestAnimationFrame` loop that samples positions and writes GeoJSON straight into MapLibre, so React never re-renders per frame.
- `mapStyle.ts` is the whole map style. Every theme has the same layers, so switching theme only pushes new paint values.
- `airportDiagram.ts` turns runway end points into pavement and paint polygons in real-world metres.
- `functions/api/aircraft.ts` tries each provider in `src/api/aircraftHandler.ts`, starting the next one early if the first is slow, and caches the result at the edge for a few seconds so all clients share one upstream request per airport.

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

### Refreshing data

```bash
npm run data:airports   # runways, positions and frequencies (OurAirports + the FAA's current 28-day cycle)
```

The FAA republishes every 28 days; re-run this when frequencies or runways change.

### Rebuilding the replay scenes

```bash
python3 -m pip install -r scripts/clips/requirements.txt
npm run clips:build     # first run downloads the voice models (~260 MB) into a git-ignored cache
npm run clips:verify    # checks timing, audio levels and that every aircraft stays on its runway
```

Scenes are defined in `scripts/clips/scenarios.py`: the script, who says it, and what each aircraft does.

## Deploy (Cloudflare Pages, free tier)

```bash
npx wrangler login
npx wrangler pages project create atc-web --production-branch master   # once
npm run deploy
```

Functions under `functions/` are picked up automatically; no environment variables or secrets are required. Live transcripts use the Workers AI binding declared in `wrangler.toml` (`[ai] binding = "AI"`); without it, and in `npm run dev`, `/api/transcribe` answers 501 and the radio plays without captions.

## Data sources & credits

- Traffic: [adsb.lol](https://adsb.lol), [adsb.fi](https://adsb.fi), [OpenSky Network](https://opensky-network.org). Community ADS-B feeds, no keys.
- Base map: [OpenFreeMap](https://openfreemap.org) © [OpenMapTiles](https://openmaptiles.org), data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Aerial imagery: [USGS The National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map) (public domain).
- Charts, US runways and frequencies: [FAA Aeronautical Information Services](https://www.faa.gov/air_traffic/flight_info/aeronav/) (US government work). Canadian airports and field elevations: [OurAirports](https://ourairports.com/data/) (public domain). Snapshot in `src/api/airportData.json`.
- Weather: [aviationweather.gov](https://aviationweather.gov) (US National Weather Service). ATIS text: [atis.info](https://atis.info). Radar: NOAA NEXRAD via the [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/).
- Routes and airframes: [adsbdb.com](https://www.adsbdb.com).
- Aircraft drawings: outlines traced from public-domain [Openclipart](https://openclipart.org) silhouettes or drawn for this project; see `src/aircraft/CREDITS.md`.
- Fonts: SF Pro where the system has it, otherwise Inter; Archivo for airport codes and callsigns (Google Fonts, OFL). Icons: Lucide (ISC). Sign plates: self-authored, drawn at runtime.
- Replay audio is synthetic: voiced with [Piper](https://github.com/OHF-Voice/piper1-gpl) using the LibriTTS and Cori Samuel voices (CC BY 4.0) and the Joe voice (CC0), then run through a radio effect. No real ATC recordings are redistributed.
- Live ATC audio: [LiveATC.net](https://www.liveatc.net), streamed straight from their servers to the browser. LiveATC's terms require their permission for public or commercial use of the streams.

Everything here is shown for interest. It is not for navigation or flight planning.

## AI summaries (optional)

`POST /api/summarize` explains a flight's recent radio calls. With no key it uses the built-in phrasebook. To use your own account, set these as Pages environment variables (or in the shell before `npm run dev`):

| Variable | Example |
| --- | --- |
| `AI_API_KEY` | your OpenRouter or Anthropic key |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` (default) or `https://api.anthropic.com` |
| `AI_MODEL` | `anthropic/claude-haiku-5.5` (default) or `claude-haiku-5-5` |

The key never reaches the browser. Identical requests are cached at the edge.
