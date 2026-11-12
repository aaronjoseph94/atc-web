# ATC Web

Live airport traffic on a painted airfield map: real runway markings, every controller frequency, a tower log of takeoffs and landings, weather with the actual ATIS, and tower-radio replays. Installable PWA, built for phones and desktops alike, and it runs entirely on free services.

**Live:** https://atc-web-62t.pages.dev

## Features

**Map**
- **Painted airfield.** Runway pavement and FAA-standard markings (threshold stripes, designators, centreline, aiming points, touchdown-zone bars, displaced-threshold arrows) are generated from surveyed runway ends, so they stay sharp at any zoom. Taxiway centrelines, holding-position bars, taxiway signs and gate numbers come from OpenStreetMap.
- **One look:** navy with a green infield, plus an optional NEXRAD weather-radar overlay (US).
- **Aircraft** drawn by airframe class (narrow-body, wide-body, four-engine, regional jet, turboprop, light, helicopter, ground vehicle), with shadows that grow with height, a wake behind everything airborne, and a controller-style data block (`045↑ B738` = 4,500 ft, climbing, 737-800).

**Live traffic**
- 37 airports (29 US, 8 Canada) from free ADS-B/MLAT aggregators (adsb.fi, adsb.lol, adsb.one, airplanes.live; OpenSky as a last resort), merged, smoothly predicted between polls and faded in and out at the edge of coverage. Each aircraft says how it was positioned (ADS-B, MLAT, TIS-B…).
- **Live radio.** Press play on the station bar (or pick a channel) to hear it live from LiveATC.net, where a feed carries that frequency (`src/api/liveatcFeeds.ts`). Each transmission is cut out of the stream in the browser, transcribed by Whisper on Cloudflare Workers AI (`/api/transcribe`), shown as a caption, in the transcript and in the flight's conversation, and the aircraft it names is highlighted while the automatic camera glides in and back out.
- **Tower log.** Takeoffs, landings, go-arounds and line-ups are detected from positions, matched to a runway, and shown as captions when the radio is off. These are stated as facts, not quotes.
- **Automatic map.** The camera moves to whoever is in the news and drifts back; drag the map to take over, tap "Back to automatic map" to hand it back.
- **Flight card.** Tap a plane: the camera locks on (TRACK), and a card shows its scheduled route, speed and altitude trends, and what it is doing ("On final for runway 27R, 2.2 nm out"). Drag it up for a drawing of the aircraft type with its facts (engines, size, seats, range), route progress and every number.
- **Channel switcher.** Every published position at the airport: one tower per runway, each ground sector, approach, departure, clearance, ATIS.
- **Weather.** Decoded METAR, a wind rose against the runways, head- and cross-wind per runway, and the real digital ATIS, which can be read aloud.
- **Traffic list** with search by flight, airline, type or tail number.
- **Spotting.** Unusual visitors are scored as they arrive (outsize freighters like the An-124 or Dreamlifter, classic trijets, A380s and 747s away from the big gateways, military and government VIP flights) and listed under *Spotted* in the traffic list, with a small star on their map tag and an occasional toast ("Rare: Antonov An-124 Ruslan inbound to ORD"). The scoring is built-in rules (`src/discovery/rarity.ts`); with AI set up by the site owner, one line on why it's notable is written per type and airport. Private aircraft are judged by type only; owners are never looked up. Toasts and stars can be switched off in Settings > Spotting.

**Replay**
- **Rewind.** The app records the traffic it shows; scrub back through the last 45 minutes at up to 8×, with logged events as markers on the timeline.
- **Recorded scenes.** Three scripted tower exchanges (O'Hare departures, a go-around at JFK, parallel arrivals at SFO) with synthesized radio audio, word-by-word subtitles, a chat-style transcript per flight, and aircraft moving on the real runways.
- **Radio explanations.** A built-in phrasebook translates calls ("hold short 27C" → "stop before runway 27C"). With AI set up by the site owner (see below), live calls are cleaned up and explained by a model before they are shown.

**Everywhere**
- **Send feedback** (menu or Settings): a few words, optionally a picture of the map, and the app's context (airport, channel, selected flight, version, screen size, recent errors) go to `/api/feedback`, which triages them and can open a GitHub issue (see below).
- Keyboard shortcuts (`?` lists them), sheets you can drag or pull down to close, tap a runway for its details, press and hold (or right-click) to centre the map, deep links per airport (`/#/JFK`), pinned and recent airports, "near me", units, reduced motion.

## Stack

| Layer | Choice |
| --- | --- |
| UI | React 19, TypeScript 7, Vite 8, Tailwind 4, Lucide icons |
| Map | MapLibre GL 6 via `react-map-gl`; own style on OpenFreeMap vector tiles (no token) |
| State | Zustand (playhead + persisted settings), TanStack Query (polling) |
| Backend | Cloudflare Pages Functions (`functions/api/*`), edge cache |
| Data | adsb.fi + adsb.lol + adsb.one + airplanes.live merged, OpenSky last resort (health-aware failover); adsbdb + hexdb; aviationweather.gov + NOAA; FAA NASR. Every source and its terms: [docs/data-sources.md](docs/data-sources.md) |
| Tooling | oxlint, Vitest, Wrangler; Python + Piper for the replay clips |

No paid APIs, fonts, icon packs or tile services are needed, and no accounts or keys. Two optional extras use the owner's own accounts, set as Cloudflare secrets: the AI features and a last-resort AirNav flight lookup (see [docs/ai-setup.md](docs/ai-setup.md)).

## Project layout

```
functions/api/        Cloudflare Pages Functions: aircraft, weather, flight, health, stations, clips/[id], summarize
public/clips/         Replay scenes: audio + manifest per clip, and index.json
public/sw.js          Service worker: caches tiles/glyphs/imagery/clips, never the shell or API
scripts/              Vite dev middleware mirroring the Functions; airport data fetcher; AI data cleanup
scripts/clips/        Clip generator: scenarios, flight kinematics, speech synthesis, radio effect, verifier
src/api/              Types, airport catalog, providers + normalizers, browser client
src/app/              Shell, top bar, side panel, menu and panels
src/discovery/        Spotting: rarity scoring of live traffic, the Spotted list, map-tag stars
src/feedback/         The Send feedback sheet, its context and error ring
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
- `mapStyle.ts` is the whole map style.
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

Two optional extras are switched on with Cloudflare secrets: the AI features (`ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`) and a last-resort flight lookup (`AIRNAV_ODAPI_TOKEN`). Step-by-step instructions, the daily caps that protect the bill, and the optional KV namespace that makes those caps exact are in [docs/ai-setup.md](docs/ai-setup.md).

## Data sources & credits

- Traffic: [adsb.lol](https://adsb.lol), [adsb.fi](https://adsb.fi), [OpenSky Network](https://opensky-network.org). Community ADS-B feeds, no keys.
- Base map: [OpenFreeMap](https://openfreemap.org) © [OpenMapTiles](https://openmaptiles.org), data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Aerial imagery: [USGS The National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map) (public domain).
- Charts, US runways and frequencies: [FAA Aeronautical Information Services](https://www.faa.gov/air_traffic/flight_info/aeronav/) (US government work). Canadian airports and field elevations: [OurAirports](https://ourairports.com/data/) (public domain). Snapshot in `src/api/airportData.json`.
- Weather: [aviationweather.gov](https://aviationweather.gov) (US National Weather Service). ATIS text: [atis.info](https://atis.info). Radar: NOAA NEXRAD via the [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/).
- Routes and airframes: [adsbdb.com](https://www.adsbdb.com), [hexdb.io](https://hexdb.io); when the owner has set a token, [AirNav Radar](https://www.airnavradar.com) for a flight none of the free sources know.
- Aircraft drawings: outlines traced from public-domain [Openclipart](https://openclipart.org) silhouettes or drawn for this project; see `src/aircraft/CREDITS.md`.
- Fonts: SF Pro where the system has it, otherwise Inter; Archivo for airport codes and callsigns (Google Fonts, OFL). Icons: Lucide (ISC); runway takeoff and landing pictograms from Google Material Icons (Apache 2.0). Sign plates: self-authored, drawn at runtime.
- Replay audio is synthetic: voiced with [Piper](https://github.com/OHF-Voice/piper1-gpl) using the LibriTTS and Cori Samuel voices (CC BY 4.0) and the Joe voice (CC0), then run through a radio effect. No real ATC recordings are redistributed.
- Live ATC audio: [LiveATC.net](https://www.liveatc.net), streamed straight from their servers to the browser. LiveATC's terms require their permission for public or commercial use of the streams.

Everything here is shown for interest. It is not for navigation or flight planning.

## AI features (optional, set up by the site owner)

The AI features (radio calls cleaned up and explained before they are shown, airport briefings, flight stories, weather in plain words, the line on why a sighting is notable) run through one endpoint, `POST /api/ai`, with the tasks in `src/api/ai/tasks/`. The key is a Cloudflare secret, `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`; there is nothing to type into the app and the browser never holds or sends a key. Settings > AI has an on/off switch for the device and a read-only line: "AI: on (Claude Opus 5.5, set in Cloudflare)" or "AI is not set up". See [docs/ai-setup.md](docs/ai-setup.md) for the exact steps.

| Secret or variable | Default | What |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` | none | The key. Without one, everything works without AI |
| `AI_PROVIDER` | `auto` | `anthropic`, `openrouter` or `auto` |
| `AI_MODEL` | `claude-opus-5-5` | Model for every task (translated to OpenRouter's names there) |
| `AI_DAILY_CAP` | `3000` | Most AI requests a day for the whole site; the radio task is held to 70% of it (`AI_TASK_CAPS` changes that) |
| `AI_RATE_BURST`, `AI_RATE_PER_MIN` | `20`, `60` | Per-visitor rate limit |
| `AI_KV` (KV binding) | none | Optional KV namespace that makes the caps one worldwide count; without it each Cloudflare data centre counts on its own |

Because every visitor spends the owner's key, `/api/ai` only answers this site's own pages, rate limits each visitor and stops at the daily cap with `429 AI daily limit reached`; the app then falls back (radio calls are shown as heard, marked "unprocessed") and says so once. Answers to identical requests are cached at the edge and are not counted. `GET /api/ai` reports today's count and the cap, as does Settings > Data and diagnostics.

**Radio calls and AI.** A transcribed call is held back for the AI pass and published (transcript, caption, history, highlight, taxi route) with the cleaned words and the AI's speaker already in place. If no answer comes within about eight seconds the call is shown as recognised with a small "unprocessed" mark, and upgraded in place when the answer arrives. When AI is off, not set up or over its cap, nothing waits. The raw words stay searchable.

`POST /api/summarize` (a flight's recent calls in a replay) is the older endpoint: built-in phrasebook by default, or a model when `AI_API_KEY` (with `AI_BASE_URL`, `AI_MODEL`) is set; it counts against the same daily cap.

For local development export the same names in the shell before `npm run dev`.

## Feedback (optional set-up)

`POST /api/feedback` always answers: it sorts the report into bug / idea / data / question with a severity, a one-line summary and the likely part of the code, using the `triageFeedback` AI task when the server has a key and keyword rules otherwise, and shows that back to the sender. It keeps a few reports per person per ten minutes. To have reports filed as GitHub issues (labelled `feedback`, the category, `severity: …` and `area: …`), set these Pages environment variables (or export them before `npm run dev`):

| Variable | What |
| --- | --- |
| `GITHUB_FEEDBACK_TOKEN` | Fine-grained token for the repo with *Issues: read and write* (and *Contents: read and write* for screenshots) |
| `GITHUB_FEEDBACK_REPO` | `owner/repo` that receives the issues |
| `GITHUB_FEEDBACK_SCREENSHOT_BRANCH` | Optional: an existing branch where map screenshots are stored and linked from the issue; without it screenshots are dropped |
| `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` | Optional: the site's AI key (see above), also used for AI triage; counted against the daily AI cap |

Without the GitHub variables the triage goes back to the sender and into the Functions log.

## AI data cleanup (offline)

`scripts/ai-cleanup.mjs` reviews the hand-kept tables in bulk and proposes fixes; it never edits a file on its own. It checks the airline table (`src/airline/airlines.ts`: ICAO/IATA codes, names, regional brands), the radio names (`src/live/radio/telephony.ts`), the aircraft facts (`src/aircraft/types.ts`: suspicious numbers), aircraft types seen in traffic with no facts entry, and airline-style callsign prefixes seen in traffic that match nothing.

```bash
node scripts/ai-cleanup.mjs --dry-run                       # what would be sent; no key needed, writes nothing
ANTHROPIC_API_KEY=… node scripts/ai-cleanup.mjs --seen seen.json   # seen.json: Settings > Data and diagnostics > Not recognised yet > Copy
node scripts/ai-cleanup.mjs --sample ORD,JFK,YYZ            # also sample live traffic from the deployed site
node scripts/ai-cleanup.mjs --apply reports/ai-cleanup-2026-11-10.patch.json   # after review; --ids a,b for a subset
```

It writes `reports/ai-cleanup-<date>.md` (local checks, every proposed change as a diff with its reason and confidence, the findings a person has to decide) and `reports/ai-cleanup-<date>.patch.json`; delete any op you disagree with before `--apply`. Claude is called through the official SDK with `ANTHROPIC_API_KEY` (as one Message Batch, at half price, when there are more than three requests; `--resume-batch <id>` collects one later) or OpenRouter with `OPENROUTER_API_KEY`. Answers are structured JSON. The model defaults to the app's default (`DEFAULT_CLAUDE_MODEL` in `src/api/ai/run.ts`); `--model` overrides it. `--help` lists every flag.
