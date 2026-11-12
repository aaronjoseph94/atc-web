import { describe, expect, it } from 'vitest'
import { reconcileRoute } from './route'

const ATL = { iata: 'ATL', icao: 'KATL' }
const LGA = { iata: 'LGA', icao: 'KLGA' }
const ORD = { iata: 'ORD', icao: 'KORD' }
const at = (heading: 'arriving' | 'departing' | 'unclear', near = true) => ({ here: 'ATL', hereIcao: 'KATL', heading, near })

describe('reconcileRoute', () => {
  it('flips the return leg of a flight landing here (DAL417 on final at ATL shown as ATL to LGA)', () => {
    const r = reconcileRoute({ origin: ATL, destination: LGA }, at('arriving'))
    expect(r.origin).toBe(LGA)
    expect(r.destination).toBe(ATL)
  })
  it('flips a departure shown as arriving here', () => {
    const r = reconcileRoute({ origin: LGA, destination: ATL }, at('departing'))
    expect(r.origin).toBe(ATL)
  })
  it('keeps a route that already fits', () => {
    const info = { origin: LGA, destination: ATL }
    expect(reconcileRoute(info, at('arriving'))).toBe(info)
  })
  it('drops a route with neither end here', () => {
    const r = reconcileRoute({ origin: ORD, destination: LGA }, at('unclear'))
    expect(r.origin).toBeNull()
    expect(r.destination).toBeNull()
  })
  it('leaves traffic away from the field alone', () => {
    const info = { origin: ORD, destination: LGA }
    expect(reconcileRoute(info, at('arriving', false))).toBe(info)
  })
})
