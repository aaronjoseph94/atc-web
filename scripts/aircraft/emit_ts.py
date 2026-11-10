"""Emit src/aircraft/outlines.ts from shapes.json. usage: emit_ts.py shapes.json out.ts"""
import json
import sys

d = json.load(open(sys.argv[1]))
SRC = {
    'oc267803': 'traced from openclipart 267803 (CC0), fuselage plugs added',
    'oc128905': 'traced from openclipart 128905 (CC0)',
    'oc348483': 'traced from openclipart 348483 (CC0), symmetrised and stretched',
    'oc27182': 'traced from openclipart 27182 (CC0), propeller added',
    'drawn': 'drawn for this project from published dimensions',
}
NOTE = {
    'ac-jet': 'Narrow-body twin (737-800 proportions)',
    'ac-ejet': 'Small twin, engines under the wing (E175 proportions)',
    'ac-heavy': 'Wide-body twin (A330-300 proportions)',
    'ac-quad': 'Four engines (747-400 span and length, A340-style planform)',
    'ac-turboprop': 'Twin turboprop, high wing, T-tail (Dash 8-400 proportions)',
    'ac-light': 'Light single, propeller (Cessna 172 span)',
    'ac-twin-piston': 'Light twin piston (Baron proportions)',
    'ac-regional': 'Regional jet, rear engines, T-tail (CRJ900 proportions)',
    'ac-bizjet': 'Business jet, rear engines, T-tail, winglets (Global 6000 proportions)',
    'ac-heli': 'Helicopter airframe (H135 class); the rotor is drawn separately',
    'ac-vehicle': 'Airside vehicle',
    'ac-dot': 'Marker for a parked aircraft whose heading is unknown',
}
out = []
out.append('/**')
out.append(' * Top-view outlines, generated from the sources listed in CREDITS.md.')
out.append(' *')
out.append(' * Units are metres, nose toward -y, centred on the bounding box. `half` is the')
out.append(' * right-hand side from the nose to the tail along the centreline (mirrored at')
out.append(' * runtime), `body` the fuselage profile the same way, `over` right-side parts that')
out.append(' * sit on top (T-tails, rear engines) and are mirrored too.')
out.append(' * Edit by regenerating, not by hand.')
out.append(' */')
out.append('')
out.append('export type OutlineData = { half: string; body?: string; over?: string[]; rotor?: [number, number, number]; span: number; length: number; note: string; source: string }')
out.append('')
out.append('export const OUTLINES = {')
for k, v in d.items():
    out.append(f"  // {NOTE[k]}: {SRC[v['source']]}.")
    out.append(f"  '{k}': {{")
    out.append(f"    note: '{NOTE[k]}',")
    out.append(f"    source: '{v['source']}',")
    out.append(f"    span: {v['extent'][0]},")
    out.append(f"    length: {v['extent'][1]},")
    out.append(f"    half: '{v['half']}',")
    if v['body']:
        out.append(f"    body: '{v['body']}',")
    if v['over']:
        out.append('    over: [' + ', '.join(f"'{o}'" for o in v['over']) + '],')
    if v.get('rotor'):
        out.append(f"    rotor: [{v['rotor'][0]}, {v['rotor'][1]}, {v['rotor'][2]}],")
    out.append('  },')
out.append('} satisfies Record<string, OutlineData>')
out.append('')
open(sys.argv[2], 'w').write('\n'.join(out))
