#!/usr/bin/env python3
"""
Build the airline logo set the app ships in `public/airline-logos/`.

The app never hotlinks logos: this maintenance script downloads every logo
it can find, keyed by ICAO airline code, prepares each one for the dark map
tags once, and writes small WebP files plus an `index.json` the app reads to
know which codes exist (so it never requests a missing file).

Sources, best first (the first one that yields a usable picture wins):
  1. Jxck-S/airline-logos `custom_logos` (hand-fixed by that repo's author)
  2. Jxck-S/airline-logos `flightaware_logos`: 90 px marks, the closest match
     to the reference (Delta widget, American flight symbol, KLM crown)
  3. Jxck-S/airline-logos `radarbox_logos`: same style, smaller
  4. sexym0nk3y/airline-logos `logos`
  5. Jxck-S/airline-logos `fr24_banners`, `radarbox_banners`, `avcodes_banners`:
     wordmarks, for airlines none of the above has (only compact ones that
     are not solid plates: a long thin banner is unreadable at tag size)
  6. pics.avs.io by IATA code, for airlines in `src/airline/airlines.ts` that
     still have nothing
`OVERRIDES` picks a later source where the first one is a poor match (tail
art instead of the logo, a broken file).

Processing, per logo:
  - a flat white background is flood-filled to transparent from the corners
    (interior white, like the inside of a roundel, is kept) and the
    anti-aliased fringe is un-blended from white;
  - transparent margins are trimmed;
  - artwork mostly too dark to read on the dark grey tag (jetBlue's navy,
    FedEx's purple) has its dark parts recoloured light, as the reference does;
  - the result is scaled down to fit 128 x 64 px (never up) and saved as WebP.

Usage: python3 -I scripts/fetch-airline-logos.py [--cache DIR] [--out DIR] [--only DAL,AAL]
Needs Pillow and NumPy, git, and network access to GitHub and pics.avs.io.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPOS = {
    'jxck': 'https://github.com/Jxck-S/airline-logos',
    'sexy': 'https://github.com/sexym0nk3y/airline-logos',
}
# (name, repo, folder) in priority order.
FOLDERS = [
    ('custom', 'jxck', 'custom_logos'),
    ('flightaware', 'jxck', 'flightaware_logos'),
    ('radarbox', 'jxck', 'radarbox_logos'),
    ('sexy', 'sexy', 'logos'),
    ('fr24-banner', 'jxck', 'fr24_banners'),
    ('radarbox-banner', 'jxck', 'radarbox_banners'),
    ('avcodes-banner', 'jxck', 'avcodes_banners'),
]
# Where the usual first choice is the wrong picture.
OVERRIDES = {
    'ETD': 'radarbox',  # FlightAware has tail art; the reference shows the Arabic + ETIHAD wordmark
    'AAR': 'radarbox',  # tail art again; RadarBox has the Asiana wing
    'FLE': 'fr24-banner',  # FlightAware's Flair file is a plain black disc
}
MAX_W, MAX_H = 128, 64
# Wider wordmarks shrink to a hairline in a 14 px tag slot; such banners are skipped.
BANNER_MAX_ASPECT = 4.5
# The tag fill the logos sit on (#484E58 at 76% over the navy map), as linear luminance.
TAG_LUMA = 0.056


def run(cmd):
    subprocess.run(cmd, check=True)


def ensure_repos(cache):
    for name, url in REPOS.items():
        dest = os.path.join(cache, name)
        if os.path.isdir(os.path.join(dest, '.git')):
            continue
        print(f'cloning {url}', file=sys.stderr)
        run(['git', 'clone', '--quiet', '--depth', '1', url, dest])


def listing(cache):
    """{source name: {ICAO: path}} for every repo folder."""
    out = {}
    for name, repo, folder in FOLDERS:
        d = os.path.join(cache, repo, folder)
        files = {}
        if os.path.isdir(d):
            for f in os.listdir(d):
                m = re.fullmatch(r'([A-Z0-9]{3})\.png', f)
                if m:
                    files[m.group(1)] = os.path.join(d, f)
        out[name] = files
    return out


def curated_iata():
    """ICAO -> IATA from the app's own airline table (the pics.avs.io fallback is keyed by IATA)."""
    src = open(os.path.join(ROOT, 'src', 'airline', 'airlines.ts'), encoding='utf-8').read()
    return {m.group(1): m.group(2) for m in re.finditer(r"^\s*([A-Z]{3}): \['([A-Z0-9]{2})'", src, re.M)}


def fetch_avs(cache, icao, iata):
    path = os.path.join(cache, 'avs', f'{icao}.png')
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        req = urllib.request.Request(f'https://pics.avs.io/240/120/{iata}.png', headers={'User-Agent': 'airline-logo-builder'})
        try:
            with urllib.request.urlopen(req, timeout=20) as r, open(path, 'wb') as f:
                f.write(r.read())
        except Exception:
            return None
    return path


# ---------------------------------------------------------------------------
# Image processing (pure; float arrays in 0..1, premultiplied nowhere)
# ---------------------------------------------------------------------------


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def luminance(rgb):
    lin = srgb_to_linear(rgb)
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def flood_from_corners(mask):
    """Pixels of `mask` 4-connected to any corner pixel that is itself in `mask`."""
    h, w = mask.shape
    seen = np.zeros_like(mask)
    stack = [(y, x) for y, x in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)) if mask[y, x]]
    for y, x in stack:
        seen[y, x] = True
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                stack.append((ny, nx))
    return seen


def dilate(mask, steps):
    out = mask.copy()
    for _ in range(steps):
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]
        grown[:-1, :] |= out[1:, :]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        out = grown
    return out


def remove_white_background(px):
    """Clear a flat white backdrop reached from the corners; un-blend its soft edge."""
    rgb, a = px[..., :3], px[..., 3]
    near_white = (rgb.min(axis=-1) >= 0.9) & (a >= 0.75)
    bg = flood_from_corners(near_white)
    if not bg.any():
        return px
    out = px.copy()
    out[bg, 3] = 0
    # The anti-aliased ring just inside the backdrop is part logo, part white:
    # take the white back out (colour-to-alpha against white).
    band = dilate(bg, 2) & ~bg & (a > 0)
    if band.any():
        c = rgb[band]
        alpha = np.clip((1 - c).max(axis=-1), 0, 1)
        safe = np.maximum(alpha, 1e-3)[:, None]
        out[band, :3] = np.clip(1 - (1 - c) / safe, 0, 1)
        out[band, 3] = a[band] * alpha
    return out


def trim(px, threshold=0.04):
    ys, xs = np.nonzero(px[..., 3] > threshold)
    if len(xs) == 0:
        return None
    return px[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


LIGHT = np.array([236, 238, 243]) / 255


def lighten_if_dark(px):
    """
    Recolour the dark parts of a logo that is mostly too dark for the tag.
    Left alone: logos that are mostly bright or saturated (the Delta widget's
    darker facet stays red), and dark plates that carry light artwork inside
    (a navy square with a white tick would lose the tick).
    """
    a = px[..., 3]
    vis = a > 0.15
    if vis.sum() < 20:
        return px, False
    y = luminance(px[..., :3])
    w = a[vis]
    dark = y < TAG_LUMA * 0.9
    dark_frac = (w * dark[vis]).sum() / w.sum()
    if dark_frac < 0.3:
        return px, False
    light_frac = (w * (y[vis] > 0.3)).sum() / w.sum()
    fill = (dark & vis).sum() / px[..., 3].size
    if fill > 0.55 and light_frac > 0.04:
        return px, False
    # Smooth ramp so anti-aliased and slightly lighter dark tones blend in.
    t = np.clip((TAG_LUMA * 1.6 - y) / (TAG_LUMA * 0.9), 0, 1)[..., None]
    out = px.copy()
    out[..., :3] = px[..., :3] * (1 - t) + LIGHT * t
    return out, True


def usable(px):
    """Reject blanks and slivers."""
    if px is None:
        return False
    h, w = px.shape[:2]
    return h >= 6 and w >= 6 and (px[..., 3] > 0.5).sum() >= 30


def banner_ok(px):
    """
    Banners are only worth shipping when they are compact enough to read at
    tag size and not a solid plate (a light grey or coloured box with a tiny
    wordmark in it, which the background removal can't open up).
    """
    h, w = px.shape[:2]
    if w / h > BANNER_MAX_ASPECT:
        return False
    return (px[..., 3] > 0.9).mean() < 0.9


def process(path, banner=False):
    """Returns (PIL RGBA image, recoloured) or None when the file is unusable."""
    try:
        im = Image.open(path)
        im.load()
    except Exception:
        return None
    im = im.convert('RGBA')
    px = np.asarray(im).astype(np.float32) / 255
    px = remove_white_background(px)
    px = trim(px)
    if not usable(px) or (banner and not banner_ok(px)):
        return None
    px, recoloured = lighten_if_dark(px)
    out = Image.fromarray((np.clip(px, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')
    scale = min(1, MAX_W / out.width, MAX_H / out.height)
    if scale < 1:
        size = (max(1, round(out.width * scale)), max(1, round(out.height * scale)))
        # Resample with premultiplied alpha so transparent pixels don't bleed their colour.
        out = out.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')
    return out, recoloured


# ---------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'atc-airline-logo-sources'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'airline-logos'))
    ap.add_argument('--only', default='', help='comma-separated ICAO codes (for trying changes)')
    ap.add_argument('--report', default='', help='write a JSON file of which source each logo came from')
    args = ap.parse_args()

    os.makedirs(args.cache, exist_ok=True)
    ensure_repos(args.cache)
    sources = listing(args.cache)
    for name, files in sources.items():
        print(f'{name}: {len(files)} files', file=sys.stderr)

    codes = set()
    for files in sources.values():
        codes |= set(files)
    iata = curated_iata()
    missing = sorted(c for c in iata if c not in codes)
    with ThreadPoolExecutor(8) as pool:
        avs = dict(zip(missing, pool.map(lambda c: fetch_avs(args.cache, c, iata[c]), missing)))
    sources['avs'] = {c: p for c, p in avs.items() if p}
    codes |= set(sources['avs'])

    only = {c.strip().upper() for c in args.only.split(',') if c.strip()}
    if only:
        codes &= only
    os.makedirs(args.out, exist_ok=True)
    if not only:
        for f in os.listdir(args.out):
            if f.endswith('.webp'):
                os.remove(os.path.join(args.out, f))

    order = [name for name, _, _ in FOLDERS] + ['avs']
    index_path = os.path.join(args.out, 'index.json')
    index = {}
    if only and os.path.exists(index_path):
        index = json.load(open(index_path))['logos']
    used = {}
    picked = {}
    recoloured = []

    def build(code):
        prefs = order
        if code in OVERRIDES:
            prefs = [OVERRIDES[code]] + [s for s in order if s != OVERRIDES[code]]
        for name in prefs:
            path = sources.get(name, {}).get(code)
            if not path:
                continue
            res = process(path, banner=name.endswith('-banner') or name == 'avs')
            if res:
                return code, name, res
        return code, None, None

    with ThreadPoolExecutor(os.cpu_count() or 4) as pool:
        results = list(pool.map(build, sorted(codes)))

    for code, name, res in results:
        if not res:
            index.pop(code, None)
            continue
        im, dark = res
        im.save(os.path.join(args.out, f'{code}.webp'), 'WEBP', quality=80, alpha_quality=80, method=6)
        index[code] = [im.width, im.height]
        used[name] = used.get(name, 0) + 1
        picked[code] = name
        if dark:
            recoloured.append(code)

    with open(index_path, 'w') as f:
        json.dump({'v': 1, 'maxW': MAX_W, 'maxH': MAX_H, 'logos': dict(sorted(index.items()))}, f, separators=(',', ':'))
        f.write('\n')

    if args.report:
        with open(args.report, 'w') as f:
            json.dump({'source': picked, 'recoloured': recoloured}, f, indent=1)
    total = sum(os.path.getsize(os.path.join(args.out, f)) for f in os.listdir(args.out))
    print(f'{len(index)} logos, {total / 1e6:.2f} MB, by source: {used}', file=sys.stderr)
    print(f'recoloured light: {len(recoloured)}', file=sys.stderr)


if __name__ == '__main__':
    main()
