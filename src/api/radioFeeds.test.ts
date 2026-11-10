import { describe, expect, it } from 'vitest'
import { AIRPORTS, defaultStation, getAirport } from './airports'
import { LIVEATC_FEEDS } from './liveatcFeeds'
import { feedFor, feedsAt, parseFeedName, streamUrl } from './radioFeeds'

const station = (airport: string, mhz: number) => getAirport(airport).stations.find((s) => Math.abs((s.frequencyMhz ?? 0) - mhz) < 0.003)

describe('parseFeedName', () => {
  it('reads positions and frequencies from stream names', () => {
    expect(parseFeedName('KJFK Tower 119.1')).toEqual({ kinds: ['TWR'], mhz: [119.1] })
    expect(parseFeedName('CYVR Del/Gnd/Twr')).toEqual({ kinds: ['TWR', 'GND', 'CLD'], mhz: [] })
    expect(parseFeedName('KJFK Clearance Delivery 135.050')).toEqual({ kinds: ['CLD'], mhz: [135.05] })
    expect(parseFeedName('JFK TWR 1191')).toEqual({ kinds: ['TWR'], mhz: [119.1] })
    expect(parseFeedName('CYUL App/Dep').kinds).toEqual(['APP', 'DEP'])
  })
})

describe('feed table', () => {
  it('is keyed by airports we know, with well-formed entries', () => {
    const codes = new Set(AIRPORTS.map((a) => a.icao))
    for (const [code, feeds] of Object.entries(LIVEATC_FEEDS)) {
      expect(codes.has(code), code).toBe(true)
      for (const f of feeds) {
        expect(f.mount).toMatch(/^[kc][a-z]{3}[a-z0-9_]*$/)
        expect(f.mount.slice(1, 4).toUpperCase()).toBe(code)
        expect(f.kinds.length).toBeGreaterThan(0)
        expect(f.mhz.length).toBeGreaterThan(0)
        for (const m of f.mhz) expect(m).toBeGreaterThanOrEqual(108)
      }
    }
  })

  it('every listed frequency belongs to a channel at that airport (or is announced by the feed itself)', () => {
    for (const [code, feeds] of Object.entries(LIVEATC_FEEDS)) {
      const freqs = getAirport(code).stations.map((s) => s.frequencyMhz)
      for (const f of feeds) {
        const named = parseFeedName(f.name).mhz
        for (const m of f.mhz) expect(freqs.some((x) => x != null && Math.abs(x - m) < 0.003) || named.includes(m), `${f.mount} ${m}`).toBe(true)
      }
    }
  })
})

describe('feedFor', () => {
  it('gives the reference towers their own feeds', () => {
    expect(feedFor(station('JFK', 119.1))?.mount).toBe('kjfk_twr')
    expect(feedFor(defaultStation(getAirport('ATL')))?.mount).toBe('katl_twr')
    expect(feedFor(defaultStation(getAirport('LGA')))?.mount).toMatch(/^klga_twr/)
    expect(feedFor(station('LAX', 133.9))?.mount).toBe('klax3')
    expect(feedFor(station('LAX', 120.95))?.mount).toBe('klax4')
  })

  it('prefers a dedicated feed to a combined one', () => {
    // JFK 121.9 is on "KJFK Gnd/Twr", "KJFK Ground" and "JFK GND 121.9": the dedicated one wins.
    expect(feedFor(station('JFK', 121.9))?.mount).toBe('kjfk1')
    // 123.9 (the other tower) is only carried by the combined feed.
    expect(feedFor(station('JFK', 123.9))?.mount).toBe('kjfk9_s')
  })

  it('maps sides and runways, not just kinds', () => {
    expect(feedFor(station('YYZ', 118.7))?.mount).toBe('cyyz1_twr_north')
    expect(feedFor(station('YYZ', 118.35))?.mount).toBe('cyyz1_twr_south')
    expect(feedFor(station('ORD', 132.7))?.mount).toBe('kord1n2_twr_ctr2')
    expect(feedFor(station('ORD', 128.15))?.mount).toBe('kord1n2_twr_n')
  })

  it('opens airports on a tower with live audio where there is one', () => {
    expect(feedFor(defaultStation(getAirport('LAX')))).not.toBeNull()
    expect(defaultStation(getAirport('LAX'))?.position).not.toMatch(/helicopter/i)
    expect(feedFor(defaultStation(getAirport('JFK')))?.mount).toBe('kjfk_twr')
    expect(defaultStation(getAirport('SEA'))?.kind).toBe('TWR')
  })

  it('says no when nothing carries the channel', () => {
    expect(feedFor(station('ORD', 133))).toBeNull()
    expect(feedFor(undefined)).toBeNull()
    expect(feedFor({ airport: 'ZZZ', kind: 'TWR', frequencyMhz: 118.1 })).toBeNull()
    expect(feedsAt('ZZZ')).toEqual([])
  })

  it('builds stream URLs', () => {
    expect(streamUrl('kjfk_twr')).toBe('https://d.liveatc.net/kjfk_twr')
  })
})
