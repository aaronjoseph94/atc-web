# Aircraft drawings: sources and licences

The map icons and the drawing in the flight view are rendered at runtime from
the outlines in `outlines.ts` (see `render.ts` for the shading). Nothing here
is GPL, share-alike or non-commercial.

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
- `ac-vehicle`, `ac-dot`: plain markers

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
