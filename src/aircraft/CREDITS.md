# Aircraft drawings: sources and licences

The map icons are rendered at runtime from
the top-view outlines in `outlines.ts` (see `render.ts` for the shading); the
flight view draws side views instead (below). Nothing here is GPL, share-alike or non-commercial.

## Traced from public-domain clipart

All Openclipart uploads are dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) ("All Clipart are
Released into the Public Domain", <https://openclipart.org/share>). No
attribution is required; it is given here anyway.

| Class | Source | Author | Licence | What was changed |
| --- | --- | --- | --- | --- |
| `ac-jet` narrow-body, `ac-ejet` small twin | [Airplane Wingspan Silhouette](https://openclipart.org/detail/267803/airplane-wingspan-silhouette) | GDJ (who notes it was derived from a Pixabay image; uploaded in 2016, when Pixabay content was itself CC0) | CC0 1.0 | Traced, made symmetric, scaled to real spans, fuselage plugs inserted fore and aft of the wing to reach 737-800 and E175 proportions |
| `ac-heavy` wide-body, `ac-quad` | [Airliner top view](https://openclipart.org/detail/128905/airliner-top-view) | Ciniconoclasta | CC0 1.0 | Traced, made symmetric, scaled; the quad is scaled to 747-400 span and length with outboard engines added |
| `ac-turboprop` | [Airplane Silhouette](https://openclipart.org/detail/348483/airplane-silhouette) | j4p4n | CC0 1.0 | Traced, rotated nose-up, made symmetric and smoothed, stretched to Dash 8-400 length |
| `ac-light` | [Top-down Airplane View](https://openclipart.org/detail/27182/topdown-airplane-view) | wirelizard | CC0 1.0 | Line drawing filled and traced, propeller added |

## Drawn for this project

No licence-clean top views were found for these, so they were drawn from
published dimensions and general arrangement (wingspan, length, fuselage
width, engine and tail positions) and are released with the rest of the app:

- `ac-regional`: rear-engined regional jet with a T-tail (CRJ900 proportions; also used for the ERJ-145, 717 and MD-80 family)
- `ac-bizjet`: rear-engined business jet with a T-tail and winglets (Global 6000 proportions)
- `ac-twin-piston`: light twin (Baron 58 proportions)
- `ac-heli`: light twin helicopter airframe (H135 class), with the rotor drawn by the renderer
- `ac-vehicle`, `ac-dot`: plain markers (`ac-vehicle` is now only the shadow and tap shape of a ground vehicle)

### Ground vehicles

The four airside vehicles on the map (`vehicles.ts`: a yellow follow-me /
operations car, a pushback tug, a fuel or service truck and an airport fire
engine) are drawn at runtime as a handful of rounded boxes in canvas, from
typical published sizes (car 4.9 x 2.0 m, conventional pushback tug about
7.2 x 3.0 m, refueller about 10.4 x 2.6 m, 6x6 airport fire engine about
11.6 x 3.0 m). They were drawn for this project; no outside artwork was
traced or copied, and they are released with the rest of the app. Which one an
ADS-B ground vehicle gets comes from its emitter category (`C1` emergency
vehicle: the fire engine) and its callsign (`TUG…`, `FUEL…`); the rest get the
car.

## Side views (flight view)

The side profiles in the flight view's aircraft card are generated at runtime
by `sideProfiles.ts` from per-class parameters (fuselage length and height,
nose and tail-cone lengths, fin size and sweep, wing position, engine size and
placement, window rows, gear), using each type's published length where we
have it. They were drawn for this project from published dimensions and
general arrangement; no outside artwork was traced or copied, and they are
released with the rest of the app.

Candidates looked at and not used: Plane Watch's silhouette set (CC BY-NC-SA,
non-commercial), tar1090/dump1090 markers (GPL), and Wikimedia Commons
silhouettes, which are mostly CC BY-SA or military types.

## Type facts

`types.ts` holds manufacturers' published specifications (rounded), and leaves
a field out where it varies a lot between versions.

## Regenerating

`scripts/aircraft/build.sh [scratch-dir]` downloads the four SVGs, rasterises
them (Playwright), traces them (OpenCV), builds every class and writes
`outlines.ts`. It reproduces the committed file exactly.
