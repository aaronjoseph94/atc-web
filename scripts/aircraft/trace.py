"""
Trace a rasterized top-view aircraft drawing into a symmetric right-half outline in metres.

usage: python trace.py in.png angle_deg span_m length_m out_prefix [blur_px] [eps_px]
  length_m: 0 keeps the drawing's own proportions (uniform scale from the span).
  angle_deg: rough rotation (counter-clockwise, degrees) that turns the drawing nose-up; refined +-12 deg.
Writes out_prefix.txt (half outline "x,y x,y ..." from nose to tail, x>=0, metres, y down = aft)
and out_prefix_check.png (overlay for eyeballing).
"""
import sys
import numpy as np
import cv2

src, angle0, span, length, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
blur = float(sys.argv[6]) if len(sys.argv) > 6 else 1.5
eps = float(sys.argv[7]) if len(sys.argv) > 7 else 0.6

img = cv2.imread(src, cv2.IMREAD_GRAYSCALE)
ink = (img < 128).astype(np.uint8)
# Fill: anything not reachable from the border over non-ink is part of the aircraft (handles line drawings).
h, w = ink.shape
pad = np.pad(1 - ink, 1, constant_values=1).astype(np.uint8)
ff = pad.copy()
mask_ff = np.zeros((h + 4, w + 4), np.uint8)
cv2.floodFill(ff, mask_ff, (0, 0), 2)
outside = (ff[1:-1, 1:-1] == 2)
solid = (~outside).astype(np.uint8)
# Keep the biggest blob only.
n, lab, stats, _ = cv2.connectedComponentsWithStats(solid, 8)
big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
solid = (lab == big).astype(np.uint8)

ys, xs = np.nonzero(solid)
cy, cx = ys.mean(), xs.mean()
S = int(max(h, w) * 1.5)


def rotated(a):
    M = cv2.getRotationMatrix2D((cx, cy), a, 1.0)
    M[0, 2] += S / 2 - cx
    M[1, 2] += S / 2 - cy
    return cv2.warpAffine(solid.astype(np.float32), M, (S, S), flags=cv2.INTER_LINEAR)


def sym_score(m):
    cols = m.sum(0)
    xc = (cols * np.arange(S)).sum() / cols.sum()
    shift = S / 2 - xc
    M = np.float32([[1, 0, shift], [0, 1, 0]])
    mm = cv2.warpAffine(m, M, (S, S), flags=cv2.INTER_LINEAR)
    f = mm[:, ::-1]
    inter = np.minimum(mm, f).sum()
    union = np.maximum(mm, f).sum()
    return inter / union, mm


best = None
for a in np.arange(angle0 - 12, angle0 + 12.01, 1.0):
    s, _ = sym_score(rotated(a))
    if best is None or s > best[0]:
        best = (s, a)
a1 = best[1]
for a in np.arange(a1 - 1, a1 + 1.001, 0.1):
    s, _ = sym_score(rotated(a))
    if s > best[0]:
        best = (s, a)
score, ang = best
# Fine horizontal centring by symmetry.
m = rotated(ang)
_, m = sym_score(m)
bests = None
for dx in np.arange(-6, 6.01, 0.25):
    M = np.float32([[1, 0, dx], [0, 1, 0]])
    mm = cv2.warpAffine(m, M, (S, S), flags=cv2.INTER_LINEAR)
    f = mm[:, ::-1]
    sc = np.minimum(mm, f).sum() / np.maximum(mm, f).sum()
    if bests is None or sc > bests[0]:
        bests = (sc, mm)
m = bests[1]
print('angle', round(ang, 2), 'symmetry', round(bests[0], 4), file=sys.stderr)

# Symmetrize: average with the mirror image after a light blur, threshold at half.
mb = cv2.GaussianBlur(m, (0, 0), blur) if blur > 0 else m
sym = ((mb + mb[:, ::-1]) / 2 > 0.5).astype(np.uint8)
ys, xs = np.nonzero(sym)
top, bot, left, right = ys.min(), ys.max(), xs.min(), xs.max()
axis = S / 2 - 0.5  # mirror axis in pixel coords (between columns S/2-1 and S/2)
width_px = right - left + 1
height_px = bot - top + 1

contours, _ = cv2.findContours(sym, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
c = max(contours, key=cv2.contourArea)
c = cv2.approxPolyDP(c, eps, True)[:, 0, :].astype(float)

sx = span / width_px
sy = length / height_px if length > 0 else sx
pts = [((x - axis) * sx, (y - (top + bot) / 2) * sy) for x, y in c]
# Rotate list so it starts at the nose (minimum y near x=0), walk the right side (x>0) to the tail.
i0 = min(range(len(pts)), key=lambda i: (pts[i][1], abs(pts[i][0])))
pts = pts[i0:] + pts[:i0]
# Contour orientation: make sure we go toward +x first.
if pts[1][0] < pts[-1][0]:
    pts = [pts[0]] + pts[1:][::-1]
half = [(0.0, pts[0][1])]
for x, y in pts[1:]:
    if x < -1e-6:
        break
    half.append((max(0.0, x), y))
# Close on the centreline at the tail.
half.append((0.0, half[-1][1]))
# Drop points that sit on the axis except the ends.
half = [half[0]] + [p for p in half[1:-1] if p[0] > 0.004] + [half[-1]]
txt = ' '.join(f'{x:.2f},{y:.2f}' for x, y in half)
open(out + '.txt', 'w').write(txt)
print('points', len(half), 'width_px', width_px, 'height_px', height_px, file=sys.stderr)

# Check image: draw the outline over the symmetric mask.
crop = (sym[top - 10:bot + 10, left - 10:right + 10] * 200).astype(np.uint8)
vis = cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR)
poly = np.array([[(x / sx + axis - (left - 10)), (y / sy + (top + bot) / 2 - (top - 10))] for x, y in half], np.int32)
cv2.polylines(vis, [poly], False, (0, 0, 255), 2)
cv2.imwrite(out + '_check.png', vis)
