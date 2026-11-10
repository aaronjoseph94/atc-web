/**
 * Feeds an `<audio>` element from a live MP3 stream through Media Source
 * Extensions instead of pointing `src` at the stream.
 *
 * Why: LiveATC streams are tiny (about 11 kbit/s), and Chrome waits for tens
 * of kilobytes before it starts a stream given by URL, which at that rate is
 * 20 to 30 seconds of "Connecting…". Appending the bytes ourselves starts
 * playback within a second or two. It also tells us the HTTP status of the
 * stream (the element only says "error"), and the blob URL keeps Web Audio
 * free to read the samples.
 *
 * Where MSE can't play MP3 (iPhone Safari), the player falls back to `src`.
 */

type Events = {
  /** Bytes arrived (the stream is alive). */
  onData: () => void
  /** The server answered with an error status (404: the feed is offline). */
  onHttpError: (status: number) => void
  /** The stream ended or broke. */
  onEnd: () => void
  /** MSE itself failed: use plain `src` instead. */
  onUnsupported: () => void
}

export type MseStream = { stop: () => void }

/** Played audio kept before it is dropped from the buffer, and how much to keep behind the playhead when trimming. */
const TRIM_AFTER_S = 60
const KEEP_BEHIND_S = 15

/** Whether this browser can play an MP3 stream through MSE. */
export function canStreamMp3(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.MediaSource && window.MediaSource.isTypeSupported('audio/mpeg')
  } catch {
    return false
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

/** Start streaming `url` into `media`. Call `stop()` before reusing the element. */
export function streamInto(media: HTMLAudioElement, url: string, events: Events): MseStream {
  const ms = new MediaSource()
  const ctrl = new AbortController()
  const pending: Uint8Array[] = []
  let sb: SourceBuffer | null = null
  let stopped = false
  const objectUrl = URL.createObjectURL(ms)
  media.src = objectUrl

  const pump = () => {
    if (!sb || sb.updating || stopped || ms.readyState !== 'open') return
    // Keep memory flat on a long listen: drop audio heard a while ago.
    const b = sb.buffered
    if (b.length && media.currentTime - b.start(0) > TRIM_AFTER_S) {
      sb.remove(b.start(0), media.currentTime - KEEP_BEHIND_S)
      return
    }
    if (!pending.length) return
    const chunk = concat(pending.splice(0))
    try {
      sb.appendBuffer(chunk as BufferSource)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'QuotaExceededError' && b.length) {
        // Full: drop everything behind the playhead and try again shortly.
        pending.unshift(chunk)
        sb.remove(b.start(0), Math.max(b.start(0) + 0.1, media.currentTime - 2))
      } else if (!stopped) events.onEnd()
    }
  }

  ms.addEventListener(
    'sourceopen',
    () => {
      URL.revokeObjectURL(objectUrl)
      if (stopped) return
      try {
        sb = ms.addSourceBuffer('audio/mpeg')
        // MP3 carries no timestamps: lay frames end to end.
        sb.mode = 'sequence'
      } catch {
        events.onUnsupported()
        return
      }
      sb.addEventListener('updateend', pump)
      void (async () => {
        let res: Response
        try {
          res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
        } catch {
          if (!stopped) events.onEnd()
          return
        }
        if (!res.ok || !res.body) {
          if (!stopped) events.onHttpError(res.status)
          return
        }
        const reader = res.body.getReader()
        // Read chunk after chunk until the stream ends, breaks or is stopped.
        // Each read starts the next without waiting on it, so nothing piles up over a long listen.
        const next = (): void =>
          void reader.read().then(
            (chunk) => {
              if (stopped) return
              if (chunk.done) {
                events.onEnd()
                return
              }
              pending.push(chunk.value)
              pump()
              events.onData()
              next()
            },
            () => {
              if (!stopped) events.onEnd()
            },
          )
        next()
      })()
    },
    { once: true },
  )

  return {
    stop: () => {
      stopped = true
      ctrl.abort()
      // A stream stopped before the element opened it (a quick channel change) never reaches
      // `sourceopen`, so its URL would otherwise pin the MediaSource for the life of the page.
      URL.revokeObjectURL(objectUrl)
      try {
        if (ms.readyState === 'open') ms.endOfStream()
      } catch {
        // Already closed.
      }
    },
  }
}

/** Seconds of audio buffered ahead of the playhead. */
export function bufferedAhead(media: HTMLAudioElement): number {
  const b = media.buffered
  return b.length ? b.end(b.length - 1) - media.currentTime : 0
}
