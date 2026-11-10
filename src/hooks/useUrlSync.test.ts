import { describe, expect, it } from 'vitest'
import { airportFromHash, hashUpdate } from './useUrlSync'

describe('airportFromHash', () => {
  it('reads the code with or without the slash, in any case', () => {
    expect(airportFromHash('#/JFK')).toBe('JFK')
    expect(airportFromHash('#ord')).toBe('ORD')
    expect(airportFromHash('#/yyc/extra')).toBe('YYC')
  })
  it('ignores hashes without a three-letter code', () => {
    expect(airportFromHash('')).toBeNull()
    expect(airportFromHash('#/')).toBeNull()
    expect(airportFromHash('#/KJFK')).toBeNull()
  })
})

describe('hashUpdate', () => {
  it('leaves the address alone when it already names the airport (Back or Forward got us here)', () => {
    expect(hashUpdate('#/ORD', 'ORD', false, false)).toBeNull()
  })
  it('replaces on first load so the page does not start with an extra history entry', () => {
    expect(hashUpdate('', 'JFK', true, false)).toBe('replace')
  })
  it('pushes when the user picks another airport, so Back returns to the last one', () => {
    expect(hashUpdate('#/JFK', 'ORD', false, false)).toBe('push')
  })
  it('only tidies a hash the user typed for this airport', () => {
    expect(hashUpdate('#/sfo', 'SFO', false, false)).toBe('replace')
  })
  it('replaces for the hops a replay makes in and out', () => {
    expect(hashUpdate('#/JFK', 'SFO', false, true)).toBe('replace')
  })
})
