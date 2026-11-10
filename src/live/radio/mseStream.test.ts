import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamInto } from './mseStream'

/** Just enough of MediaSource for `streamInto` to start: it never opens unless told to. */
class FakeMediaSource extends EventTarget {
  readyState = 'closed'
}

describe('streamInto', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lets go of the MediaSource when stopped before the element opened it', () => {
    vi.stubGlobal('MediaSource', FakeMediaSource)
    const live = new Set<string>()
    let n = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const u = `blob:test/${n++}`
      live.add(u)
      return u
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => void live.delete(u))
    const media = { src: '' } as HTMLAudioElement
    // A quick run of channel changes: each stream is replaced before it ever opens.
    for (let i = 0; i < 5; i++) streamInto(media, 'https://example.test/feed', { onData() {}, onHttpError() {}, onEnd() {}, onUnsupported() {} }).stop()
    expect(live.size).toBe(0)
  })
})
