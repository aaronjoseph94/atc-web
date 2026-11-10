#!/usr/bin/env bash
# Regenerate src/aircraft/outlines.ts from the public-domain source drawings.
#
# Needs: node with playwright (to rasterise SVG), python3 with opencv-python-headless and numpy.
# The source SVGs are downloaded from openclipart.org (all CC0) into a scratch directory.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
work="${1:-$(mktemp -d)}"
mkdir -p "$work"

for id in 267803 128905 348483 27182; do
  [ -f "$work/$id.svg" ] || curl -sSL -o "$work/$id.svg" "https://openclipart.org/download/$id"
done

node "$here/rasterize.cjs" 2400 "$work/267803.svg" "$work/r_267803.png"
node "$here/rasterize.cjs" 5000 "$work/128905.svg" "$work/r_128905.png"
node "$here/rasterize.cjs" 2400 "$work/348483.svg" "$work/r_348483.png"
node "$here/rasterize.cjs" 2400 "$work/27182.svg" "$work/r_27182.png"

# rough rotation to nose-up, real span (m), 0 = keep the drawing's proportions, blur, simplification
python3 "$here/trace.py" "$work/r_267803.png" 0 35.8 0 "$work/narrow" 1.2 0.5
python3 "$here/trace.py" "$work/r_128905.png" 90 60.3 0 "$work/wide" 1.2 0.5
python3 "$here/trace.py" "$work/r_348483.png" 45 27.4 0 "$work/turboprop" 3 0.8
python3 "$here/trace.py" "$work/r_27182.png" 0 11.0 0 "$work/light" 1.5 0.5

python3 "$here/build_shapes.py" "$work" "$work/shapes.json"
python3 "$here/emit_ts.py" "$work/shapes.json" "$root/src/aircraft/outlines.ts"
echo "wrote $root/src/aircraft/outlines.ts (scratch: $work)"
