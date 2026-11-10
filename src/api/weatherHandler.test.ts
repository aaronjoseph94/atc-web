import { afterEach, describe, expect, it, vi } from 'vitest'
import awcCyyc from './__fixtures__/awc-metar-cyyc.json'
import awcTaf from './__fixtures__/awc-taf-kjfk.json'
import tgftpCyyc from './__fixtures__/tgftp-metar-cyyc.txt?raw'
import tgftpKjfk from './__fixtures__/tgftp-metar-kjfk.txt?raw'
import tgftpTaf from './__fixtures__/tgftp-taf-kjfk.txt?raw'
import { sourceHealth } from './sourceHealth'
import { fetchMetar, fetchTaf, fetchWeather, flightCategoryFor, normalizeAtis, normalizeMetar, parseMetarText, parseTgftp, type AwcMetar } from './weatherHandler'

describe('NOAA text fallback (real captures)', () => {
  it('decodes the same observation as the aviationweather.gov JSON', () => {
    const { issued, body } = parseTgftp(tgftpCyyc)
    expect(issued?.toISOString()).toBe('2026-11-10T07:00:00.000Z')
    const fromText = parseMetarText(body, issued!)
    const fromJson = normalizeMetar((awcCyyc as AwcMetar[])[0])
    const pick = (m: typeof fromText) => m && { ...m, raw: undefined }
    expect(pick(fromText)).toEqual(pick(fromJson))
    expect(fromText?.raw).toBe('CYYC 100700Z 28006KT 15SM BKN073 08/M05 A2984 RMK AC7 CIG RAG SLP129')
  })

  it('decodes a US report', () => {
    const { issued, body } = parseTgftp(tgftpKjfk)
    expect(parseMetarText(body, issued!)).toMatchObject({
      observedAt: '2026-11-10T06:51:00.000Z',
      windDirDeg: 290,
      windKt: 7,
      visibilitySm: 10,
      tempC: 10,
      dewpointC: 1,
      altimeterInHg: 29.99,
      clouds: [
        { cover: 'SCT', baseFt: 4500 },
        { cover: 'SCT', baseFt: 25000 },
      ],
      flightCategory: 'VFR',
      weather: null,
    })
  })

  it('handles gusts, fractions, weather, vertical visibility and ICAO style', () => {
    const us = parseMetarText('KORD 101651Z VRB05G18KT 1 1/2SM -RA BR VV004 M02/M03 A2990 RMK X', new Date('2026-11-10T17:00Z'))
    expect(us).toMatchObject({ windVariable: true, windDirDeg: null, gustKt: 18, visibilitySm: 1.5, weather: '-RA BR', tempC: -2, dewpointC: -3, flightCategory: 'LIFR' })
    const icao = parseMetarText('EGLL 101650Z 24012MPS 9999 FEW030 BKN045 12/08 Q1013 NOSIG', new Date('2026-11-10T17:00Z'))
    expect(icao).toMatchObject({ windKt: 23, visibilitySm: 6.2, visibilityPlus: true, altimeterInHg: 29.91, flightCategory: 'VFR' })
    expect(parseMetarText('KSFO 100056Z 00000KT P6SM CLR 15/10 A3001', new Date('2026-11-10T01:00Z'))).toMatchObject({ windDirDeg: null, windKt: 0, visibilityPlus: true, clouds: [{ cover: 'CLR', baseFt: null }] })
  })

  it('dates a report from the end of last month correctly', () => {
    expect(parseMetarText('KJFK 312351Z 29007KT 10SM CLR 10/01 A2999', new Date('2026-11-01T00:10Z'))?.observedAt).toBe('2026-10-31T23:51:00.000Z')
  })

  it('rejects garbage', () => {
    expect(parseMetarText('')).toBeNull()
    expect(parseMetarText('<html>Not Found</html>')).toBeNull()
  })

  it('flight category thresholds', () => {
    expect(flightCategoryFor(null, null)).toBeNull()
    expect(flightCategoryFor(3000, 10)).toBe('MVFR')
    expect(flightCategoryFor(3100, 6)).toBe('VFR')
    expect(flightCategoryFor(900, 10)).toBe('IFR')
    expect(flightCategoryFor(null, 0.5)).toBe('LIFR')
  })

  it('TAF text joins its continuation lines', () => {
    expect(parseTgftp(tgftpTaf).body).toMatch(/^TAF KJFK \d{6}Z .* FM100900 27010KT P6SM SCT050 BKN200 FM101500/)
  })
})

describe('weather failover', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sourceHealth.reset()
  })

  it('uses NOAA text when aviationweather.gov fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('aviationweather.gov') ? new Response('', { status: 502 }) : new Response(tgftpCyyc))),
    )
    const r = await fetchMetar('CYYC')
    expect(r.source).toBe('tgftp.nws.noaa.gov')
    expect(r.value?.windKt).toBe(6)
  })

  it('prefers aviationweather.gov when it answers', async () => {
    const fetchMock = vi.fn(async (url: string) => (url.includes('aviationweather.gov') ? new Response(JSON.stringify(awcTaf)) : new Response(tgftpTaf)))
    vi.stubGlobal('fetch', fetchMock)
    const r = await fetchTaf('KJFK')
    expect(r.source).toBe('aviationweather.gov')
    expect(r.value).toMatch(/^TAF KJFK/)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reports where each part came from, and rehearsed failures switch to the fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('invalid.invalid')) throw new TypeError('fetch failed')
        if (url.includes('atis.info')) return new Response('[]')
        if (url.includes('/taf/') || url.includes('forecasts')) return new Response(tgftpTaf)
        return new Response(tgftpKjfk)
      }),
    )
    const w = await fetchWeather('JFK', { ATC_FAIL_SOURCES: 'aviationweather.gov' })
    expect(w.sources).toEqual({ metar: 'tgftp.nws.noaa.gov', taf: 'tgftp.nws.noaa.gov', atis: null })
    expect(w.metar?.windDirDeg).toBe(290)
    expect(w.taf).toMatch(/^TAF KJFK/)
  })
})

describe('normalizeMetar', () => {
  it('decodes a typical US observation', () => {
    const m = normalizeMetar({
      rawOb: 'METAR KORD 092151Z 21008KT 10SM BKN300 15/03 A3002 RMK AO2',
      obsTime: 1794261060,
      temp: 15,
      dewp: 3.3,
      wdir: 210,
      wspd: 8,
      visib: '10+',
      altim: 1016.7,
      clouds: [{ cover: 'BKN', base: 30000 }],
      fltCat: 'VFR',
    })
    expect(m).toMatchObject({
      raw: 'KORD 092151Z 21008KT 10SM BKN300 15/03 A3002 RMK AO2',
      windDirDeg: 210,
      windKt: 8,
      windVariable: false,
      visibilitySm: 10,
      visibilityPlus: true,
      altimeterInHg: 30.02,
      flightCategory: 'VFR',
      clouds: [{ cover: 'BKN', baseFt: 30000 }],
    })
    expect(m?.observedAt).toBe(new Date(1794261060 * 1000).toISOString())
  })

  it('treats variable and calm winds as having no direction', () => {
    expect(normalizeMetar({ rawOb: 'X', wdir: 'VRB', wspd: 4 })).toMatchObject({ windDirDeg: null, windVariable: true, windKt: 4 })
    expect(normalizeMetar({ rawOb: 'X', wdir: 0, wspd: 0 })).toMatchObject({ windDirDeg: null, windVariable: false, windKt: 0 })
  })

  it('returns null without a raw observation', () => {
    expect(normalizeMetar(undefined)).toBeNull()
    expect(normalizeMetar({ temp: 4 })).toBeNull()
  })
})

describe('normalizeAtis', () => {
  it('orders split broadcasts arrival first and drops empty rows', () => {
    const a = normalizeAtis([
      { type: 'dep', code: 'c', datis: 'DEP INFO C' },
      { type: 'arr', code: 'B', datis: 'ARR INFO B' },
      { type: 'arr', code: 'Z', datis: '  ' },
    ])
    expect(a.map((x) => [x.kind, x.code])).toEqual([
      ['arrival', 'B'],
      ['departure', 'C'],
    ])
  })

  it('tolerates an error payload', () => {
    expect(normalizeAtis({ error: 'No results found' } as never)).toEqual([])
  })
})
