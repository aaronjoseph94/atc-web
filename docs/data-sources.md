# Data sources

Every outside service the app uses, what it costs, what its terms ask of us, and how the app stays inside them.
Checked November 2026. Terms change; re-check before a public launch, and treat this as engineering notes, not legal advice.

**Short version:** everything below is free and needs no API key. Most community sources are free for
**non-commercial** use only, so if the app ever makes money (ads, subscriptions, paid app), the rows marked
"non-commercial" need a written OK or a paid plan first. Two things need the owner's action now:

1. **LiveATC (radio):** get written permission before the app plays LiveATC streams for anyone other than you (see [Radio](#atc-radio)).
2. **airplanes.live (traffic):** the owner has airplanes.live's approval, so it is on by default; set `ATC_ENABLE_AIRPLANES_LIVE=0` to switch it off (see [ADS-B](#ads-b-positions)).

## How the app uses them

- All upstream calls run on the server (Cloudflare Pages Functions, `functions/api/*`), never from the browser,
  with an identifying `User-Agent`. Answers are cached at the Cloudflare edge so every viewer of an airport shares
  one upstream request: traffic 4 s, weather 3 min, airframes 7 days, routes 1 h, unknown lookups 15 min.
- Each source has a circuit breaker (`src/api/sourceHealth.ts`): after two failures in a row it is skipped for 20 s,
  doubling while it keeps failing (up to 5 min); a `429` pauses it for a minute, a `403` for 5 minutes.
  Feeds with a per-second limit are not called again inside that interval.
- `GET /api/health?airport=JFK` reports every source's status, latency and breaker state (also shown in
  Settings, "Data feed"). Add `&probe=all` to probe OpenSky too (off by default to save its daily allowance).
- To rehearse an outage locally: `ATC_FAIL_SOURCES=adsb.fi,aviationweather.gov npm run dev` points those sources at a
  dead host; traffic and weather keep flowing from the others. The same variable works in Pages settings.

## ADS-B positions

`src/api/aircraftHandler.ts`. The two healthiest feeds are asked at once and merged (freshest position per aircraft,
missing details filled from the other), a slow feed is hedged with the next after 1.5 s, an empty answer is
double-checked with one more feed, and the last good answer is served for up to 90 s if every feed fails.
Response headers `X-Provider`, `X-Sources` and `X-Attribution` say which feeds answered; the map's attribution
line credits them.

| Source | Endpoint used | Terms / licence | Limits | Attribution / permission |
| --- | --- | --- | --- | --- |
| [adsb.fi](https://adsb.fi) open data | `opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{nm}` | Personal, **non-commercial** use; no reselling; as-is ([terms](https://github.com/adsbfi/opendata)) | 1 request/s per IP; 4xx answers count towards a temporary ban | Must cite adsb.fi with a link (map attribution + Help). Contact them for commercial use or higher rates. |
| [adsb.lol](https://adsb.lol) | `api.adsb.lol/v2/point/{lat}/{lon}/{nm}` | Open data under **ODbL 1.0** | "Dynamic", load-based; no key today. They say a key (free, for feeders) will be required in future. | ODbL attribution (map attribution + Help say "adsb.lol (ODbL)"). If a key becomes mandatory: feed data to adsb.lol or request a key at adsb.lol, then add it as a Pages secret. |
| [airplanes.live](https://airplanes.live) | `api.airplanes.live/v2/point/{lat}/{lon}/{nm}` | **Non-commercial**, no SLA | 1 request/s | **On** (the owner has their approval). Unapproved callers get 403 "Please contact us…"; if that appears, the failover skips it. `ATC_ENABLE_AIRPLANES_LIVE=0` switches it off. |
| [OpenSky Network](https://opensky-network.org) | `opensky-network.org/api/states/all?lamin…` (anonymous) | Free for research and **non-commercial** use; commercial use needs a licence from OpenSky | Anonymous: 400 credits/day per IP (an airport-sized box costs 1), 10 s resolution | Credit "The OpenSky Network" (map attribution + Help). Used only when every other feed has errored. It has refused requests from Cloudflare's network before (HTTP 522), so don't count on it in production; a free OpenSky account (OAuth2 client credentials, 4,000 credits/day) is the upgrade path if needed. |

Not used: ADS-B Exchange (its API is paid), FlightAware and Flightradar24 (paid, no redistribution).

## Aircraft details (registration, type, operator, route)

`src/api/flightSources.ts` merges these over the adsbdb answer from `src/api/flightInfoHandler.ts`. Each field is
picked by confidence (adsbdb 3, hexdb 2, feed 1.5; agreeing sources add up). The response lists `sources`.

| Source | Endpoint used | Terms | Limits | Attribution / permission |
| --- | --- | --- | --- | --- |
| [adsbdb.com](https://www.adsbdb.com) | `api.adsbdb.com/v0/aircraft/{hex}?callsign=…`, `/v0/callsign/{cs}` | Free, no key, code MIT. Airframe data from PlaneBase; **route data © David Taylor and Jim Mason: "may not be copied, published, or incorporated into other databases" without permission** | None published; we cache | Fine for per-flight lookups shown to a user. Don't bulk-download routes into our own database. Credited in Help. |
| [hexdb.io](https://hexdb.io) | `hexdb.io/api/v2/aircraft/{hex}`, `/api/v2/routes/{callsign}` | Free, no key; no written terms. Data from PlaneBase/PlanePlotter, Jim Mason, Steve Hibberd, Airport-Data | None published; we cache | Credited in Help. Its routes carry `updated_at`; routes older than 18 months are ignored and adsbdb's route always wins. |
| ADS-B feeds' own tables (adsb.fi, adsb.lol) | `opendata.adsb.fi/api/v2/hex/{hex}`, `api.adsb.lol/v2/hex/{hex}` | As in the ADS-B table | Same per-second limits | Only asked when neither database knows the airframe. Registration and type also arrive with every position (`r`, `t`). |
| [airport-data.com](https://www.airport-data.com) (photos) | `airport-data.com/api/ac_thumb.json` | Photos are the photographers' copyright; the site asks for the photographer's name and a link back | — | Being removed from the app by another change. |

## Weather and ATIS

`src/api/weatherHandler.ts`. METAR and TAF from aviationweather.gov; if it errors or takes more than 2.5 s
(it sometimes takes 10 s+), the same reports are fetched as text from NOAA's file server and decoded locally.

| Source | Endpoint used | Terms | Limits | Attribution / permission |
| --- | --- | --- | --- | --- |
| [aviationweather.gov](https://aviationweather.gov/data/api/) (NOAA/NWS) | `/api/data/metar?ids=…&format=json`, `/api/data/taf?ids=…&format=json` | US government data, public domain | **100 requests/min**, set a custom User-Agent; CORS not allowed (so server-side only) | None required; credited in Help. |
| [NOAA tgftp](https://tgftp.nws.noaa.gov/data/) | `/data/observations/metar/stations/{ICAO}.TXT`, `/data/forecasts/taf/stations/{ICAO}.TXT` | US government data, public domain | None published; static files | None required. |
| [atis.info](https://atis.info) | `atis.info/api/{ICAO}` | Free, no key, no written terms | None published; we cache 3 min | Credited in Help. US airports only. The other public D-ATIS API (datis.clowd.io) now redirects here, so there is no independent fallback; the panel works without ATIS. |
| [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/) NEXRAD tiles | `mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png` | Free public service of Iowa State University; NOAA radar data | Be considerate; tiles are cached by the service worker | Credit IEM (map attribution). |

## Map, imagery, charts, airport data

| Source | Used for | Terms | Attribution |
| --- | --- | --- | --- |
| [OpenFreeMap](https://openfreemap.org) | Vector tiles (`tiles.openfreemap.org/planet`) and fonts | Free, no key, no request limits, commercial use allowed | Required: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors (shown by MapLibre) |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) (via OpenFreeMap) | Taxiway lines, holding bars, signs, gates, buildings | ODbL 1.0 | "© OpenStreetMap contributors" (shown) |
| [USGS The National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map) | Aerial imagery (`basemap.nationalmap.gov`) | US government work, public domain | Credit requested (shown) |
| [FAA Aeronautical Information Services](https://www.faa.gov/air_traffic/flight_info/aeronav/) | VFR sectional/terminal chart tiles (FAA's ArcGIS tile services) | US government work, public domain | Credit + "not for navigation" (shown) |
| [FAA NASR](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/) | Runway ends, controller frequencies (US) | US government work, public domain | Credited in Help |
| [FAA CIFP](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/) (Coded Instrument Flight Procedures) | Arrival (STAR), departure (SID) and approach paths, fixes and altitude constraints (US), the map's "Procedures" layer | US government work, public domain; free download each 28-day AIRAC cycle from aeronav.faa.gov | Credited in Help; "not for navigation" (Help) |
| [OurAirports](https://ourairports.com/data/) | Runways and frequencies (Canada, fallback) | Public domain | Credited in Help |
| [Piper](https://github.com/rhasspy/piper) voices | Synthesized radio in the bundled replay scenes | Per-voice licence on the model card; the LibriTTS-based voices are CC BY 4.0 | Credit the voice datasets if the scenes ship publicly |

**Procedures.** `npm run data:procedures` (`scripts/fetch-procedures.mjs`) downloads the CIFP in force, reads the
ARINC 424 records for our US airports and writes `public/procedures/{code}.json` (committed; 20–140 KB each,
10–20 KB gzipped). Legs to fixes are drawn straight, RF/AF arcs as points, and heading legs ("climb on heading 044
to 520 ft", "expect vectors") as short stubs, so the lines are a sketch of the published paths, not a navigation
source. Refresh every cycle or two. **Canada:** the CIFP covers only FAA procedures, and NAV CANADA's procedure data
(Canada Flight Supplement, Canada Air Pilot, the AIP and its ARINC data) is copyright NAV CANADA and not licensed
for redistribution, so there is no free legal source; Canadian airports keep just the extended runway centrelines.

## ATC radio

The ADS-B feeds carry no audio. Live ATC audio exists only where volunteers run scanners and stream them, so every
option below is someone else's stream with their own rules.

| Source | What it is | Can the app use it? |
| --- | --- | --- |
| [LiveATC.net](https://www.liveatc.net) | Largest network of volunteer airband feeds (US, Canada and more); streams are CORS-enabled | **Only with permission.** Their terms limit streams to personal, non-commercial listening, ask sites to consult them before linking directly to streams, and the site states that third-party use of the live streams is prohibited. Testing it yourself is personal use; before the app plays LiveATC audio for other people, write to LiveATC (contact link on liveatc.net) describing the app, expected listeners, that streams are played unmodified with credit and a link, and that no ads are inserted. Keep the existing "Listen live on LiveATC" link-out as the fallback if they decline. |
| [Broadcastify](https://www.broadcastify.com) (RadioReference) | Scanner feeds, including some airband | Directory/catalog API through the Broadcastify Developer Program (bcfy.io/dev, free sign-up, application). Playing live audio in a third-party app needs their approval, and RadioReference requires a licence for commercial apps. Few airport tower feeds compared with LiveATC. |
| Own receivers | An RTL-SDR dongle + airband antenna near the airport running RTLSDR-Airband into an Icecast server | Free apart from hardware, and fully under the owner's control. US: receiving ATC is legal; rebroadcasting is the same practice LiveATC relies on (47 U.S.C. 605 exempts communications relating to aircraft). **Canada (YYC, YYZ …):** the Radiocommunication Act s. 9(2) restricts divulging non-broadcast radio communications; get advice or NAV CANADA's view before streaming Canadian frequencies. Many other countries (e.g. the UK) forbid even listening without a licence. |
| FAA / NTSB released recordings | ATC audio and transcripts released under FOIA or in NTSB accident dockets | US government records, public domain. Not live, but legal material for future replay scenes. |
| Not options | VATSIM/IVAO voice is simulated pilots, not real ATC, and is not publicly streamable. YouTube ATC channels are copyrighted edits. No project called openATC or atc.live with real feeds turned up. | |

What to keep doing whatever the radio source: credit the feed (name + link) next to the player, don't modify or
re-host the audio, don't insert ads into it, and stop on request.
