import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const dir = path.resolve('public/clips/ord-tower-demo')
fs.mkdirSync(dir, { recursive: true })

// --- WAV (self-authored CC0 soft tone) ---
const sr = 22050
const dur = 8
const n = sr * dur
const dataSize = n * 2
const buf = Buffer.alloc(44 + dataSize)
buf.write('RIFF', 0)
buf.writeUInt32LE(36 + dataSize, 4)
buf.write('WAVE', 8)
buf.write('fmt ', 12)
buf.writeUInt32LE(16, 16)
buf.writeUInt16LE(1, 20)
buf.writeUInt16LE(1, 22)
buf.writeUInt32LE(sr, 24)
buf.writeUInt32LE(sr * 2, 28)
buf.writeUInt16LE(2, 32)
buf.writeUInt16LE(16, 34)
buf.write('data', 36)
buf.writeUInt32LE(dataSize, 40)
for (let i = 0; i < n; i++) {
  const t = i / sr
  const env = Math.min(1, t * 4) * Math.min(1, (dur - t) * 4)
  const s = Math.sin(2 * Math.PI * 440 * t) * 0.12 * env
  buf.writeInt16LE((s * 32767) | 0, 44 + i * 2)
}
fs.writeFileSync(path.join(dir, 'audio.wav'), buf)

const manifest = {
  id: 'ord-tower-demo',
  stationId: 'ord-tower-28r',
  audioUrl: '/clips/ord-tower-demo/audio.wav',
  durationMs: 8000,
  title: 'ORD Tower demo',
  cues: [
    {
      id: 'c1',
      startMs: 200,
      endMs: 2200,
      text: 'United twenty ninety-nine heavy runway two eight right cleared for takeoff',
      callsign: 'UAL2099',
      speaker: 'Tower',
    },
    {
      id: 'c2',
      startMs: 2400,
      endMs: 4200,
      text: 'Cleared for takeoff two eight right United twenty ninety-nine heavy',
      callsign: 'UAL2099',
      speaker: 'Pilot',
    },
    {
      id: 'c3',
      startMs: 4500,
      endMs: 6800,
      text: 'American five forty contact departure one two six point four seven',
      callsign: 'AAL540',
      speaker: 'Tower',
    },
    {
      id: 'c4',
      startMs: 7000,
      endMs: 7900,
      text: 'One two six four seven American five forty',
      callsign: 'AAL540',
      speaker: 'Pilot',
    },
  ],
  tracks: {
    UAL2099: [
      { tMs: 0, lat: 41.9786, lon: -87.9048, heading: 280, altitudeFt: 0, speedKt: 0 },
      { tMs: 2000, lat: 41.9792, lon: -87.9105, heading: 282, altitudeFt: 80, speedKt: 140 },
      { tMs: 5000, lat: 41.9805, lon: -87.922, heading: 285, altitudeFt: 900, speedKt: 180 },
      { tMs: 8000, lat: 41.982, lon: -87.935, heading: 288, altitudeFt: 2200, speedKt: 220 },
    ],
    AAL540: [
      { tMs: 0, lat: 41.976, lon: -87.898, heading: 95, altitudeFt: 1200, speedKt: 160 },
      { tMs: 4000, lat: 41.9755, lon: -87.888, heading: 100, altitudeFt: 1800, speedKt: 190 },
      { tMs: 8000, lat: 41.975, lon: -87.875, heading: 105, altitudeFt: 2800, speedKt: 230 },
    ],
  },
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0a0e14"/><path fill="#F5C518" d="M256 72c8 0 14 9 16 26l8 64 104 45c7 3 10 8 10 14v13c0 6-4 9-10 7L280 216l4 55 40 26c5 3 8 7 8 11v10c0 4-4 6-8 4L256 300l-68 22c-4 2-8 0-8-4v-10c0-4 3-8 8-11l40-26 4-55-108-26c-6-2-10-1-10 7v-13c0-6 3-11 10-14l104-45 8-64c2-17 8-26 16-26z"/></svg>'
fs.writeFileSync('public/favicon.svg', svg)

/** Minimal solid-color PNG (navy) for PWA icons. */
function solidPng(size, rgb = [10, 14, 20]) {
  const row = Buffer.alloc(1 + size * 3)
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = rgb[0]
    row[2 + x * 3] = rgb[1]
    row[3 + x * 3] = rgb[2]
  }
  const raw = Buffer.alloc((1 + size * 3) * size)
  for (let y = 0; y < size; y++) row.copy(raw, y * row.length)
  const compressed = zlib.deflateSync(raw)

  function chunk(type, data) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeBuf = Buffer.from(type)
    const crc = Buffer.alloc(4)
    const crcVal = crc32(Buffer.concat([typeBuf, data]))
    crc.writeUInt32BE(crcVal >>> 0)
    return Buffer.concat([len, typeBuf, data, crc])
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
  }
  return ~c
}

fs.writeFileSync('public/pwa-192.png', solidPng(192, [10, 14, 20]))
fs.writeFileSync('public/pwa-512.png', solidPng(512, [10, 14, 20]))
console.log('assets ok')
