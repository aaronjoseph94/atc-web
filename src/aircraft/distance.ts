/**
 * Euclidean distance transforms over anti-aliased alpha masks
 * (Felzenszwalb & Huttenlocher's exact method). Used for the signed distance
 * field the map's shadow layer needs, and for the "how far inside the
 * silhouette" field the artwork shading is built from.
 */

const INF = 1e20

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s: number
    do {
      const r = v[k]
      s = (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r)
    } while (s <= z[k] && --k > -1)
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const r = v[k]
    d[q] = (q - r) * (q - r) + f[r]
  }
}

/** In place: squared seeds in, Euclidean distances out. */
function edt(grid: Float64Array, w: number, h: number) {
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) grid[y * w + x] = Math.sqrt(d[x])
  }
}

/** Alpha (0..1, one value per pixel) → distance in pixels to the nearest outside pixel; 0 outside. */
export function insideDistance(alpha: Float32Array, w: number, h: number): Float64Array {
  const g = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i]
    // Anti-aliased edge pixels seed sub-pixel distances.
    g[i] = a >= 1 ? INF : a <= 0 ? 0 : Math.max(0, a - 0.5) ** 2
  }
  edt(g, w, h)
  return g
}

/**
 * Turn an RGBA alpha mask into the distance field MapLibre expects for
 * `sdf: true` images: 0.75 on the edge, falling off over `radius` pixels.
 */
export function maskToSdf(alpha: Uint8ClampedArray, w: number, h: number, radius = 8): Uint8ClampedArray {
  const outside = new Float64Array(w * h)
  const inside = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i * 4 + 3] / 255
    outside[i] = a >= 1 ? 0 : a <= 0 ? INF : Math.max(0, 0.5 - a) ** 2
    inside[i] = a >= 1 ? INF : a <= 0 ? 0 : Math.max(0, a - 0.5) ** 2
  }
  edt(outside, w, h)
  edt(inside, w, h)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const d = outside[i] - inside[i]
    out[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, 0.75 - d / radius)))
  }
  return out
}
