import { afterEach, describe, expect, it, vi } from 'vitest'
import adsbFiFixture from './__fixtures__/adsbfi-jfk.json'
import { buildHealth } from './healthHandler'
import { memoryCache, sourceHealth } from './sourceHealth'

describe('buildHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sourceHealth.reset()
  })

  it('reports every source, marks a dead feed, and keeps traffic flowing from the rest', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('adsb.lol')) return new Response('', { status: 502 })
      if (url.includes('opensky')) throw new Error('should not be probed by default')
      if (url.includes('adsb.fi')) return new Response(JSON.stringify(adsbFiFixture))
      if (url.includes('tgftp')) return new Response('2026/11/10 06:51\nKJFK 100651Z 29007KT 10SM CLR 10/01 A2999\n')
      if (url.includes('hexdb')) return new Response(JSON.stringify({ registration: 'N1' }))
      if (url.includes('adsbdb')) return new Response(JSON.stringify({ response: {} }))
      return new Response('[]')
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = await buildHealth('JFK', 'test', undefined, { cache: memoryCache() })
    expect(h.ok).toBe(true)
    expect(h.provider).toBe('adsb.fi')
    expect(h.aircraft).toBe(4)
    const by = Object.fromEntries((h.sources ?? []).map((s) => [s.name, s]))
    expect(Object.keys(by).sort()).toEqual(['adsb.fi', 'adsb.lol', 'adsbdb.com', 'airplanes.live', 'atis.info', 'aviationweather.gov', 'hexdb.io', 'opensky', 'tgftp.nws.noaa.gov'])
    expect(by['adsb.lol']).toMatchObject({ ok: false, error: 'HTTP 502' })
    expect(by['adsb.fi'].ok).toBe(true)
    expect(by['airplanes.live'].enabled).not.toBe(false)
    expect(by['opensky'].note).toMatch(/not probed/)
    expect(by['tgftp.nws.noaa.gov']).toMatchObject({ ok: true, kind: 'weather' })
  })

  it('shows rehearsed failures as failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('invalid.invalid') ? Promise.reject(new TypeError('fetch failed')) : new Response(JSON.stringify(url.includes('adsb') ? adsbFiFixture : [])))),
    )
    const h = await buildHealth('ORD', 'test', undefined, { env: { ATC_FAIL_SOURCES: 'aviationweather.gov' } })
    expect(h.sources?.find((s) => s.name === 'aviationweather.gov')).toMatchObject({ ok: false, error: 'fetch failed' })
  })
})
