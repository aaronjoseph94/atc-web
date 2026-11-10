/**
 * Cuts a live radio stream into transmissions.
 *
 * ATC audio is squelched: between calls the feed is silent or sits on a low,
 * steady noise floor, and a call is a burst of energy well above it. So a
 * plain energy detector works: track the floor, open when the level jumps a
 * clear margin above it for a few frames, close after a short hangover of
 * quiet (pauses between words must not split a call), and keep a little
 * audio from just before the opening so the first syllable isn't clipped.
 *
 * Calls shorter than `minMs` (squelch tails, key clicks) are dropped; calls
 * longer than `maxMs` are cut so a stuck microphone can't hold a segment open.
 *
 * Replies often follow within half a second, too soon for the hangover. But
 * on a squelched feed the gap between two calls is dead air (the receiver
 * mutes), while a pause inside a call still carries the transmitter's hiss.
 * So when the feed's floor is that quiet, a short run of dead air also ends
 * a call.
 */

export type SegmenterOptions = {
  sampleRate: number
  /** Analysis frame length. */
  frameMs?: number
  /** Shortest call kept. */
  minMs?: number
  /** Longest call before it is cut. */
  maxMs?: number
  /** Quiet needed to end a call. */
  hangoverMs?: number
  /** Audio kept from before the call opened. */
  preRollMs?: number
  /** Frames above the threshold needed to open a call. */
  attackFrames?: number
  /** How far above the floor (as an RMS ratio; 3 ≈ +10 dB) counts as speech. */
  margin?: number
  /** Below this RMS nothing is speech, however quiet the floor. */
  absoluteMin?: number
  /** Dead air (squelch closed) needed to end a call on a squelched feed. */
  squelchGapMs?: number
}

export type Segment = {
  samples: Float32Array
  sampleRate: number
  /** Stream time (seconds since the segmenter started) of the first sample. */
  startS: number
  durationMs: number
  /** True when the call ran past `maxMs` and was cut. */
  cut: boolean
}

/** A floor this quiet (about -56 dBFS) means the feed mutes between calls. */
const SQUELCHED_FLOOR = 0.0016
/** Anything below this (about -76 dBFS) is dead air whatever the floor. */
const DEAD_AIR = 0.00016

export class Segmenter {
  readonly sampleRate: number
  private readonly frame: number
  private readonly minFrames: number
  private readonly maxFrames: number
  private readonly hangFrames: number
  private readonly preFrames: number
  private readonly attackFrames: number
  private readonly margin: number
  private readonly absoluteMin: number
  private readonly squelchFrames: number
  /** Consecutive frames of dead air inside the open call. */
  private dead = 0

  /** Partial frame carried between pushes. */
  private carry: Float32Array
  private carryLen = 0
  /** Recent quiet frames, for pre-roll. */
  private pre: Float32Array[] = []
  /** Frames of the call in progress. */
  private call: Float32Array[] = []
  private hot = 0
  private quiet = 0
  private open = false
  private callStartFrame = 0
  private frameIndex = 0
  /** Running noise floor (RMS). */
  private floor = 0.002

  constructor(opts: SegmenterOptions) {
    this.sampleRate = opts.sampleRate
    const frameMs = opts.frameMs ?? 20
    this.frame = Math.max(16, Math.round((opts.sampleRate * frameMs) / 1000))
    const per = (ms: number) => Math.max(1, Math.round(ms / frameMs))
    this.minFrames = per(opts.minMs ?? 600)
    this.maxFrames = per(opts.maxMs ?? 25_000)
    this.hangFrames = per(opts.hangoverMs ?? 700)
    this.preFrames = per(opts.preRollMs ?? 240)
    this.attackFrames = opts.attackFrames ?? 3
    this.margin = opts.margin ?? 3
    this.absoluteMin = opts.absoluteMin ?? 0.006
    this.squelchFrames = per(opts.squelchGapMs ?? 260)
    this.carry = new Float32Array(this.frame)
  }

  /** True while a call is open. */
  get speaking(): boolean {
    return this.open
  }

  /** Current noise floor estimate (RMS), for diagnostics. */
  get noiseFloor(): number {
    return this.floor
  }

  /** Feed audio; returns any calls that ended inside it. */
  push(samples: Float32Array): Segment[] {
    const done: Segment[] = []
    let i = 0
    while (i < samples.length) {
      const take = Math.min(this.frame - this.carryLen, samples.length - i)
      this.carry.set(samples.subarray(i, i + take), this.carryLen)
      this.carryLen += take
      i += take
      if (this.carryLen === this.frame) {
        const seg = this.onFrame(this.carry.slice())
        if (seg) done.push(seg)
        this.carryLen = 0
      }
    }
    return done
  }

  /** End any call in progress (stream stopped or channel changed). */
  flush(): Segment | null {
    const seg = this.open ? this.close(false) : null
    this.reset()
    return seg
  }

  reset() {
    this.open = false
    this.call = []
    this.pre = []
    this.hot = 0
    this.quiet = 0
    this.dead = 0
    this.carryLen = 0
  }

  private onFrame(frame: Float32Array): Segment | null {
    const index = this.frameIndex++
    let sum = 0
    for (let k = 0; k < frame.length; k++) sum += frame[k] * frame[k]
    const rms = Math.sqrt(sum / frame.length)
    const threshold = Math.max(this.absoluteMin, this.floor * this.margin)
    const loud = rms > threshold

    if (!this.open) {
      // The floor follows quiet quickly downwards and noise slowly upwards;
      // the opening of a call barely moves it, but noise that stays loud for
      // half a minute or more becomes the new floor.
      const rise = loud ? 0.0005 : 0.01
      this.floor = rms < this.floor ? this.floor + (rms - this.floor) * 0.3 : this.floor + (rms - this.floor) * rise
      this.floor = Math.max(1e-5, this.floor)
      this.pre.push(frame)
      if (this.pre.length > this.preFrames + this.attackFrames) this.pre.shift()
      this.hot = loud ? this.hot + 1 : 0
      if (this.hot >= this.attackFrames) {
        this.open = true
        this.quiet = 0
        this.call = this.pre
        this.pre = []
        this.callStartFrame = index - this.call.length + 1
      }
      return null
    }

    this.call.push(frame)
    this.quiet = loud ? 0 : this.quiet + 1
    // Dead air: far below anything a keyed transmitter makes. Only meaningful on a squelched feed.
    const squelched = this.floor < SQUELCHED_FLOOR
    this.dead = squelched && rms < Math.max(this.floor * 1.6, DEAD_AIR) ? this.dead + 1 : 0
    if (this.quiet >= this.hangFrames || this.dead >= this.squelchFrames) return this.close(false)
    if (this.call.length >= this.maxFrames) return this.close(true)
    return null
  }

  /** Finish the open call. Trailing quiet beyond a short tail is trimmed. */
  private close(cut: boolean): Segment | null {
    const keepTail = Math.min(this.quiet, Math.round(this.hangFrames / 3))
    const frames = this.call.slice(0, this.call.length - this.quiet + keepTail)
    const startFrame = this.callStartFrame
    this.open = false
    this.call = []
    this.hot = 0
    this.quiet = 0
    this.dead = 0
    // A cut call carries straight on: the next frames open a new one if still loud.
    const voiced = frames.length - this.preFrames
    if (voiced < this.minFrames) return null
    const samples = new Float32Array(frames.length * this.frame)
    frames.forEach((f, k) => samples.set(f, k * this.frame))
    if (cut) this.hot = this.attackFrames
    return {
      samples,
      sampleRate: this.sampleRate,
      startS: (startFrame * this.frame) / this.sampleRate,
      durationMs: (samples.length / this.sampleRate) * 1000,
      cut,
    }
  }
}
