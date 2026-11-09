# ATC Web

Free-tier ATC.com-style PWA: live OpenSky traffic on MapLibre, multi-airport picker, ORD demo playback with karaoke transcripts. Cloudflare Pages + Functions.

## Local run

```bash
npm install
npm run dev
```

Open the printed Vite URL (usually `http://localhost:5173`). Dev middleware serves `/api/*` without Wrangler.

```bash
npm test
npm run build
```

## Airport switcher

- Tap the **airport code** in the top chrome or yellow station bar.
- Sheet lists **US** then **Canada** (ATL…LGA, YYZ…YEG).
- Default is **ORD**. Switching eases the map camera and re-queries OpenSky for that airport’s bbox.
- Demo **Playback** clip pack is ORD-only; other airports use live traffic + idle transcript.

## Deploy (Cloudflare Pages)

```bash
npx wrangler login
npm run build
npx wrangler pages project create atc-web   # once
npx wrangler pages deploy dist
```

Or `npm run deploy` after login. Functions under `functions/` bind automatically.

## Stack

Vite · React 19 · Tailwind 4 · MapLibre · TanStack Query · Zustand · Cloudflare Pages Functions · OpenSky · OpenFreeMap
