export type Aircraft = {
  icao24: string
  callsign: string
  lat: number
  lon: number
  heading: number
  altitudeFt: number | null
  speedKt: number | null
  onGround: boolean
}

export type TranscriptCue = {
  id: string
  startMs: number
  endMs: number
  text: string
  callsign?: string
  speaker?: string
}

export type TrackSample = {
  tMs: number
  lat: number
  lon: number
  heading: number
  altitudeFt?: number
  speedKt?: number
}

export type ClipPack = {
  id: string
  stationId: string
  audioUrl: string
  durationMs: number
  title: string
  cues: TranscriptCue[]
  tracks: Record<string, TrackSample[]>
}

export type Station = {
  id: string
  airport: string
  name: string
  label: string
}
