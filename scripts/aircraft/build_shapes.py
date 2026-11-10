"""
Build every aircraft class's top-view outline (right half, metres, nose at -y) plus the
fuselage profile and any parts drawn on top (T-tails, rear-mounted engines).

Sources:
  narrow/ejet  <- openclipart 267803 "Airplane Wingspan Silhouette" (GDJ, CC0), a 737-700,
                  fuselage plugs added to reach 737-800 / E175 proportions
  wide/quad    <- openclipart 128905 "airliner top view" (CC0), an A330-class twin; the quad
                  adds an outboard engine each side and is stretched to 747-400 proportions
  turboprop    <- openclipart 348483 "Airplane Silhouette" (j4p4n, CC0), symmetrised, stretched to Q400
  light        <- openclipart 27182 "topdown airplane view" (CC0)
  regional, bizjet, heli, vehicle, dot <- drawn here from published dimensions

usage: python build_shapes.py <trace_dir> <out.json>
"""
import json
import math
import sys

import cv2
import numpy as np

tdir, out = sys.argv[1], sys.argv[2]


def load(name):
    return [tuple(map(float, p.split(','))) for p in open(f'{tdir}/{name}.txt').read().split()]


def scale(pts, k):
    return [(x * k, y * k) for x, y in pts]


def plug(pts, cuts):
    """Insert fuselage plugs: every point aft of cut y moves aft by its length. cuts = [(y, len)]."""
    res = []
    for x, y in pts:
        dy = sum(l for c, l in cuts if y > c)
        res.append((x, y + dy))
    return res


def recentre(pts_list):
    ys = [y for pts in pts_list for _, y in pts]
    mid = (min(ys) + max(ys)) / 2
    return [[(x, y - mid) for x, y in pts] for pts in pts_list]


def mirror_full(half):
    return half + [(-x, y) for x, y in reversed(half)]


def rasterize(polys, ppm, pad=2.0):
    """polys: list of full polygons in metres. Returns mask, transform."""
    xs = [x for p in polys for x, _ in p]
    ys = [y for p in polys for _, y in p]
    x0, y0 = min(xs) - pad, min(ys) - pad
    W = int((max(xs) - x0 + pad) * ppm)
    H = int((max(ys) - y0 + pad) * ppm)
    # Even width so the centreline falls between pixel columns.
    W += W % 2
    x0 = -W / 2 / ppm
    m = np.zeros((H, W), np.uint8)
    for p in polys:
        arr = np.array([[(x - x0) * ppm * 16, (y - y0) * ppm * 16] for x, y in p], np.int32)
        cv2.fillPoly(m, [arr], 255, lineType=cv2.LINE_AA, shift=4)
    return m, x0, y0


def trace(polys, ppm=60, blur=1.2, eps=0.45, full=False):
    m, x0, y0 = rasterize(polys, ppm)
    mf = m.astype(np.float32) / 255
    if blur > 0:
        mf = cv2.GaussianBlur(mf, (0, 0), blur)
    mf = (mf + mf[:, ::-1]) / 2
    b = (mf > 0.5).astype(np.uint8)
    cs, _ = cv2.findContours(b, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)
    c = cv2.approxPolyDP(c, eps, True)[:, 0, :].astype(float)
    W = m.shape[1]
    pts = [((x + 0.5) / ppm + x0, (y + 0.5) / ppm + y0) for x, y in c]
    if full:
        return pts
    i0 = min(range(len(pts)), key=lambda i: (pts[i][1], abs(pts[i][0])))
    pts = pts[i0:] + pts[:i0]
    if pts[1][0] < pts[-1][0]:
        pts = [pts[0]] + pts[1:][::-1]
    half = [(0.0, pts[0][1])]
    for x, y in pts[1:]:
        if x < -1e-6:
            break
        half.append((max(0.0, x), y))
    half.append((0.0, half[-1][1]))
    return [half[0]] + [p for p in half[1:-1] if p[0] > 0.004] + [half[-1]]


def leading_edge_y(half, x):
    """Most-forward outline y near span station x (assumes the wing LE is the forward boundary there)."""
    best = None
    for (xa, ya), (xb, yb) in zip(half, half[1:]):
        if min(xa, xb) <= x <= max(xa, xb) and xa != xb:
            t = (x - xa) / (xb - xa)
            y = ya + t * (yb - ya)
            if best is None or y < best:
                best = y
    return best


def rect(cx, y0, y1, hw, r=0.0):
    """Rounded rectangle (right-side part) as a polygon."""
    pts = []
    n = 6
    r = min(r, hw, (y1 - y0) / 2)
    corners = [(cx + hw - r, y0 + r, -90, 0), (cx + hw - r, y1 - r, 0, 90), (cx - hw + r, y1 - r, 90, 180), (cx - hw + r, y0 + r, 180, 270)]
    for ccx, ccy, a0, a1 in corners:
        for i in range(n + 1):
            a = math.radians(a0 + (a1 - a0) * i / n)
            pts.append((ccx + r * math.cos(a), ccy + r * math.sin(a)))
    return pts


def nacelle(cx, y0, y1, hw):
    """Engine pod seen from above: rounded intake, slight bulge, tapered exhaust."""
    L = y1 - y0
    pts = []
    steps = 24
    for i in range(steps + 1):
        t = i / steps
        y = y0 + L * t
        # Width profile: rounded lip, fullest at 30%, taper to 70% at the nozzle.
        if t < 0.12:
            w = hw * (0.82 + 0.18 * math.sqrt(t / 0.12))
        elif t < 0.6:
            w = hw
        else:
            w = hw * (1 - 0.32 * ((t - 0.6) / 0.4) ** 1.4)
        pts.append((cx + w, y))
    for i in range(steps, -1, -1):
        t = i / steps
        y = y0 + L * t
        if t < 0.12:
            w = hw * (0.82 + 0.18 * math.sqrt(t / 0.12))
        elif t < 0.6:
            w = hw
        else:
            w = hw * (1 - 0.32 * ((t - 0.6) / 0.4) ** 1.4)
        pts.append((cx - w, y))
    return pts


def body_profile(nose, tail, hw, nose_len, taper_from, tail_hw, steps=40):
    """Fuselage right half: elliptical-ogive nose, parallel section, eased taper to the tail cone."""
    pts = [(0.0, nose)]
    for i in range(1, steps + 1):
        t = i / steps
        y = nose + nose_len * t
        # Blunt ogive: x = hw * (1 - (1-t)^2.2)^0.5
        pts.append((hw * (1 - (1 - t) ** 2.2) ** 0.55, y))
    for i in range(1, steps + 1):
        t = i / steps
        y = taper_from + (tail - taper_from) * t
        e = (1 - math.cos(math.pi * t)) / 2
        pts.append((hw + (tail_hw - hw) * e ** 0.9, y))
    pts.append((0.0, tail))
    return pts


def body_from_outline(half, wmax, cut_y, tail_y, tail_hw=0.12):
    """Fuselage profile taken from the outline where it is pure fuselage, then eased to the tail tip."""
    res = [half[0]]
    for x, y in half[1:]:
        if y >= cut_y:
            break
        if x <= wmax and y > res[-1][1]:
            res.append((x, y))
    x0, y0 = res[-1]
    for i in range(1, 25):
        t = i / 24
        e = (1 - math.cos(math.pi * t)) / 2
        res.append((x0 + (tail_hw - x0) * e, y0 + (tail_y - y0) * t))
    res.append((0.0, tail_y))
    return res


def rdp(pts, tol):
    if len(pts) < 3:
        return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    dx, dy = x1 - x0, y1 - y0
    n = math.hypot(dx, dy)
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = abs(dy * x - dx * y + x1 * y0 - y1 * x0) / n if n > 1e-9 else math.hypot(x - x0, y - y0)
        if d > dmax:
            dmax, idx = d, i
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return rdp(pts[: idx + 1], tol)[:-1] + rdp(pts[idx:], tol)


def num(v):
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    if s.startswith('-0.'):
        s = '-' + s[2:]
    elif s.startswith('0.'):
        s = s[1:]
    return '0' if s in ('', '-0', '-') else s


def fmt(pts, tol=0.0):
    if tol:
        pts = rdp(pts, tol)
    return ' '.join(f'{num(x)},{num(y)}' for x, y in pts)


shapes = {}

# ---- narrow-body: 737-700 trace, plugs fore and aft to 737-800 length (39.5 m) -------------------
nar = load('narrow')  # span 35.8, length 32.9, nose at -16.45
nb = body_from_outline(nar, 1.95, 13.3, 16.05)
nar_p = plug(nar, [(-7.0, 3.4), (6.0, 3.2)])
nb_p = plug(nb, [(-7.0, 3.4), (6.0, 3.2)])
nar_p, nb_p = recentre([nar_p, nb_p])
shapes['ac-jet'] = {'half': nar_p, 'body': nb_p, 'span': 35.8, 'length': 39.5, 'source': 'oc267803'}

# ---- small twin (E-jets, A220): same trace scaled to E175 span, plugs to its length --------------
k = 26.0 / 35.8
ej = plug(scale(nar, k), [(-7.0 * k, 4.2), (6.0 * k, 3.6)])
ejb = plug(scale(nb, k), [(-7.0 * k, 4.2), (6.0 * k, 3.6)])
ej, ejb = recentre([ej, ejb])
shapes['ac-ejet'] = {'half': ej, 'body': ejb, 'span': 26.0, 'length': 31.7, 'source': 'oc267803'}

# ---- wide-body twin: A330-class trace, plugs to A330-300 length ---------------------------------
wd = load('wide')  # span 60.3, length 61.3
wb = body_from_outline(wd, 3.15, 22.6, 30.6, 0.2)
wd_p = plug(wd, [(-17.0, 1.3), (8.0, 1.1)])
wb_p = plug(wb, [(-17.0, 1.3), (8.0, 1.1)])
wd_p, wb_p = recentre([wd_p, wb_p])
shapes['ac-heavy'] = {'half': wd_p, 'body': wb_p, 'span': 60.3, 'length': 63.7, 'source': 'oc128905'}

# ---- quad: the wide-body scaled to 747-400 span, stretched, with outboard engines ---------------
kq = 64.4 / 60.3
q = plug(scale(wd, kq), [(-17.0 * kq, 3.0), (8.0 * kq, 2.2)])
qb = plug(scale(wb, kq), [(-17.0 * kq, 3.0), (8.0 * kq, 2.2)])
q, qb = recentre([q, qb])
ox = 20.0
le = leading_edge_y(q, ox)
outer = nacelle(ox, le - 2.9, le + 1.6, 1.0)
outer_l = [(-x, y) for x, y in outer]
qh = trace([mirror_full(q), outer, outer_l], ppm=40, blur=0.8, eps=0.4)
shapes['ac-quad'] = {'half': qh, 'body': qb, 'span': 64.4, 'length': 70.7, 'source': 'oc128905'}

# ---- turboprop: symmetrised trace, stretched to Dash 8-400 length --------------------------------
kt = 28.4 / 27.4
tp = scale(load('turboprop'), kt)
tpb = body_from_outline(tp, 1.5, 8.5 * kt, 11.0 * kt, 0.25)
tp_p = plug(tp, [(-6.0 * kt, 5.6), (1.8 * kt, 4.3)])
tpb_p = plug(tpb, [(-6.0 * kt, 5.6), (1.8 * kt, 4.3)])
tp_p, tpb_p = recentre([tp_p, tpb_p])
shapes['ac-turboprop'] = {'half': tp_p, 'body': tpb_p, 'span': 28.4, 'length': 32.8, 'source': 'oc348483'}

# ---- light single: trace as is (Cessna 172 span) ------------------------------------------------
lt = load('light')
lb = body_from_outline(lt, 0.72, 2.3, 4.15, 0.06)
# Propeller across the spinner (a touch wider than real so it survives at icon size).
prop = rect(0.0, -4.32, -4.1, 0.98, 0.08)
lth = trace([mirror_full(lt), prop], ppm=200, blur=1.2)
lth, lb = recentre([lth, lb])
shapes['ac-light'] = {'half': lth, 'body': lb, 'span': 11.0, 'length': 8.4, 'source': 'oc27182'}

# ---- light twin piston (Baron / Seneca proportions) ---------------------------------------------
body = body_profile(-4.55, 4.35, 0.62, 2.0, 0.2, 0.1)
wing = [(0.4, -1.05), (5.6, -0.75), (5.78, -0.55), (5.78, 0.05), (5.6, 0.2), (0.4, 0.95)]
stab = [(0.0, 3.25), (1.95, 3.55), (2.05, 3.7), (2.05, 4.1), (1.95, 4.2), (0.0, 4.25)]
nac = rect(2.0, -2.9, 1.7, 0.42, 0.38)
prop2 = rect(2.0, -3.06, -2.88, 0.98, 0.08)
parts = [mirror_full(body), mirror_full(wing), mirror_full(stab), nac, [(-x, y) for x, y in nac], prop2, [(-x, y) for x, y in prop2]]
tw = trace(parts, ppm=200, blur=1.5)
tw, body, nac = recentre([tw, body, nac])
shapes['ac-twin-piston'] = {'half': tw, 'body': body, 'over': [nac], 'span': 11.5, 'length': 9.1, 'source': 'drawn'}

# ---- regional jet, rear engines + T-tail (CRJ900 proportions) -----------------------------------
L, hw = 36.2, 1.35
nose, tail = -L / 2, L / 2
body = body_profile(nose, 17.0, hw, 3.8, 9.5, 0.32)
wing = [(hw - 0.2, -1.6), (5.2, 1.2), (11.9, 4.2), (12.4, 4.55), (12.45, 5.2), (11.9, 5.25), (5.0, 3.95), (hw - 0.2, 3.85)]
fin_root = [(0.0, 12.0), (0.32, 12.6), (0.32, 17.6), (0.0, 17.9)]
stab = [(-0.05, 14.1), (0.6, 14.15), (4.2, 16.75), (4.3, 17.2), (4.2, 18.05), (0.6, 17.6), (-0.05, 17.55)]
eng = nacelle(2.2, 8.2, 12.8, 0.82)
pylon = rect(1.5, 9.4, 11.6, 0.4)
parts = [mirror_full(body), mirror_full(wing), mirror_full(fin_root), mirror_full(stab), eng, [(-x, y) for x, y in eng], pylon, [(-x, y) for x, y in pylon]]
shapes['ac-regional'] = {
    'half': trace(parts, ppm=60, blur=1.5),
    'body': body,
    'over': [stab, eng],
    'span': 24.9, 'length': 36.2, 'source': 'drawn',
}

# ---- business jet, rear engines + T-tail + winglets (Global 6000 proportions) -------------------
L, hw = 30.3, 1.35
nose = -L / 2
body = body_profile(nose, 13.7, hw, 3.4, 7.6, 0.3)
wing = [(x, y + 1.5) for x, y in [(hw - 0.2, -3.2), (4.0, -1.1), (13.3, 5.45), (14.1, 6.5), (14.33, 7.35), (13.9, 7.2), (13.1, 6.75), (5.2, 3.6), (hw - 0.2, 2.9)]]
fin_root = [(0.0, 9.5), (0.3, 10.0), (0.3, 14.7), (0.0, 15.1)]
stab = [(-0.05, 11.0), (0.55, 11.05), (4.35, 14.2), (4.5, 14.6), (4.35, 15.15), (0.55, 14.1), (-0.05, 14.05)]
eng = nacelle(2.3, 7.2, 11.7, 0.9)
pylon = rect(1.55, 8.3, 10.4, 0.4)
parts = [mirror_full(body), mirror_full(wing), mirror_full(fin_root), mirror_full(stab), eng, [(-x, y) for x, y in eng], pylon, [(-x, y) for x, y in pylon]]
shapes['ac-bizjet'] = {
    'half': trace(parts, ppm=70, blur=1.5),
    'body': body,
    'over': [stab, eng],
    'span': 28.65, 'length': 30.3, 'source': 'drawn',
}

# ---- helicopter (H135-class): pod, boom, stabiliser, fenestron, four blades -------------------
R = 5.1
hub = -1.2
pod = body_profile(-3.9, 2.4, 0.82, 2.2, 0.4, 0.3)
boom = rect(0.0, 1.8, 6.4, 0.24, 0.2)
hstab = rect(0.0, 5.0, 5.55, 1.35, 0.25)
fen = rect(0.0, 6.1, 7.0, 0.22, 0.2)
# The rotor (disc and blades) is drawn by the renderer, so it can spin; the outline is the airframe.
parts = [mirror_full(pod), boom, hstab, fen]
hh = trace(parts, ppm=120, blur=1.2)
lo = min(hub - R, min(y for _, y in hh))
hi = max(hub + R, max(y for _, y in hh))
mid = (lo + hi) / 2
hh = [(x, y - mid) for x, y in hh]
pod_c = [(x, y - mid) for x, y in pod]
shapes['ac-heli'] = {'half': hh, 'body': pod_c, 'rotor': [0.0, round(hub - mid, 2), R], 'span': 10.2, 'length': hi - lo, 'source': 'drawn'}

# ---- ground vehicle (tug / follow-me car) and the heading-less marker ---------------------------
veh = rect(0.0, -2.6, 2.6, 1.2, 0.45)
vh = trace([veh], ppm=100, blur=1.0)
shapes['ac-vehicle'] = {'half': vh, 'body': None, 'span': 2.4, 'length': 5.2, 'source': 'drawn'}
dot = [(1.0 * math.cos(math.radians(t)), 1.0 * math.sin(math.radians(t))) for t in range(0, 360, 6)]
shapes['ac-dot'] = {'half': trace([dot], ppm=200, blur=1.0), 'body': None, 'span': 2.0, 'length': 2.0, 'source': 'drawn'}

res = {}
for k, s in shapes.items():
    xs = [x for x, _ in s['half']]
    ys = [y for _, y in s['half']]
    tol = 0.0008 * max(s['span'], s['length'])
    res[k] = {
        'half': None if s.get('full') else fmt(s['half'], tol),
        'full': fmt(s['full'] + s['full'][:1], tol) if s.get('full') else None,
        'body': fmt(s['body'], tol) if s.get('body') else None,
        'over': [fmt(p + p[:1], tol) for p in s.get('over', [])],
        'span': s['span'],
        'length': round(s['length'], 2),
        'extent': [round(2 * s['rotor'][2] if s.get('rotor') else 2 * max(xs), 2), round(s['length'] if s.get('rotor') else max(ys) - min(ys), 2)],
        'rotor': s.get('rotor'),
        'points': len(s['half']),
        'source': s['source'],
    }
    print(k, res[k]['extent'], res[k]['points'], file=sys.stderr)
json.dump(res, open(out, 'w'), indent=1)
